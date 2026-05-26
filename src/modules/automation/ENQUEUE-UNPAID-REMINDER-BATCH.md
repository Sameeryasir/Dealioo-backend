# `enqueueUnpaidReminderBatch()` — how it works

This function is the **shared “get ready to send” step** for bulk payment reminders. It does **not** send emails itself. It:

1. Reads the automation flow from the database  
2. Finds who should get the email (unpaid customers)  
3. Creates one **execution** row (a “run”)  
4. Puts a **background job** in Redis so the worker can send emails later  

**Code:** `automation.service.ts` — private method `enqueueUnpaidReminderBatch`  
**Worker that sends emails:** `runUnpaidReminderBatch()` (called by BullMQ after this function finishes)

---

## Plain English (30 seconds)

Think of it as **booking a delivery**:

| Step | Real world | What the code does |
|------|------------|-------------------|
| 1 | Read the recipe | Load flow nodes (trigger → condition → email) |
| 2 | Check the recipe is for “unpaid only” | `sendToUnpaidOnly` must be true |
| 3 | List customers who haven’t paid | Query funnel payments + customers |
| 4 | Write “delivery scheduled” on the board | Insert `automation_execution` with status `queued` |
| 5 | Hand the package to the warehouse queue | Redis job `unpaid-reminder-batch` |
| 6 | Tell the UI “run #42 is queued, 12 people” | Return execution status to API |

The **warehouse** (queue worker) picks up the job and actually sends via Brevo.

---

## Who calls it?

Only **two** places — same function, different behavior when nobody is unpaid:

```text
                    ┌─────────────────────────────┐
                    │  enqueueUnpaidReminderBatch │
                    └──────────────▲──────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
   POST /automation/execution              Cron timer (runCronTick)
   startExecution()                        (every N minutes)
              │                                         │
   skipIfNoRecipients: false                skipIfNoRecipients: true
   → error if 0 unpaid                      → return null, log, no error
```

| Caller | When | `skipIfNoRecipients` |
|--------|------|----------------------|
| `startExecution` | User clicks Run / API | `false` |
| `runCronTick` | Scheduled cron fires | `true` |

Checks like “automation active”, “has funnel”, “not already running” happen **before** this function in the caller — not inside `enqueueUnpaidReminderBatch`.

---

## Inputs and output

### Inputs

```typescript
enqueueUnpaidReminderBatch(
  automation: Automation,           // must have funnelId, campaign optional
  options: { skipIfNoRecipients: boolean },
)
```

The `automation` object should already be loaded from the database (with `campaign` relation when possible, for email subject placeholders).

### Output

| Result | Meaning |
|--------|---------|
| `{ status: AutomationExecutionStatusDto }` | Success — run created and job queued |
| `null` | Only when `skipIfNoRecipients: true` and zero unpaid customers (cron) |
| Throws `BadRequestException` | Wrong flow, no unpaid (manual), missing email node, etc. |

---

## Step-by-step (matches the code)

### Step 1 — Build the execution plan

```typescript
const plan = await this.flowService.buildExecutionPlan(automation.id);
```

**File:** `automation-flow.service.ts`

Loads all nodes for this automation, sorted by `order`.

| Field | Meaning |
|-------|---------|
| `nodes` | Full list in order |
| `startNodeId` | First node’s id (stored on execution) |
| `endNodeId` | Last node’s id |
| `emailNode` | The node with `type = email` (required) |
| `conditionNode` | The node with `type = condition` (optional) |
| `sendToUnpaidOnly` | `true` if condition text means “has not paid” / `payment_not_paid` |

**Fails if:**

- No nodes → “Build the flow first”  
- No email node → “Flow must include an email node”

---

### Step 2 — Prepare the email content

```typescript
const prepared = this.automationEmailService.prepareFromEmailNode(
  plan.emailNode.config,
  automation.purpose,
  { requireSubject: true, campaignName },
);
```

Reads subject/body/template from the **email node config**. Uses campaign name for placeholders (e.g. “Reminder for {campaign}”).

Nothing is sent yet — this only builds the `PreparedAutomationEmail` object that the worker will use.

---

### Step 3 — Load recipients (unpaid only)

```typescript
if (plan.sendToUnpaidOnly) {
  recipients = await this.recipientsService.getUnpaidCustomersForFunnel(automation.funnelId);
} else {
  throw new BadRequestException('Flow condition must target customers who have not completed payment.');
}
```

**`sendToUnpaidOnly` must be true** — otherwise enqueue stops with 400. Your flow needs a **condition** node whose label/type looks like unpaid (see flow service).

**File:** `automation-recipients.service.ts`

1. Find `funnel_payment` rows for this funnel with status: `pending`, `failed`, or `cancelled`  
2. Collect unique customer emails  
3. Match to `customer` table  
4. Return list: `{ customerId, email, name }[]`

**If list is empty:**

| `skipIfNoRecipients` | Behavior |
|----------------------|----------|
| `false` (manual run) | Throw 400 — “No unpaid customers found for this funnel” |
| `true` (cron) | Return `null` — no execution, no queue job |

---

### Step 4 — Create execution row in the database

```typescript
const execution = await this.executionService.createExecution(
  {
    automationId: automation.id,
    currentNodeId: plan.startNodeId,
    purpose: automation.purpose,
  },
  recipients[0].customerId,
  {
    status: AutomationExecutionStatus.QUEUED,
    totalRecipients: recipients.length,
  },
);
```

**Table:** `automation_execution`

| Column | Value at enqueue time |
|--------|------------------------|
| `status` | `queued` |
| `total_recipients` | Number of people to email |
| `emails_sent_count` | `0` |
| `customer_id` | First recipient (bulk run uses one row for the whole batch) |
| `current_node_id` | Start node of the flow |
| `queue_job_id` | Set in step 5 |

This is what the frontend shows in the “runs” tab and what you poll by `executionId`.

---

### Step 5 — Build the queue job payload

```typescript
const batch: UnpaidReminderBatchJob = {
  executionId: execution.id,
  emailNodeId: plan.emailNode.id,
  conditionNodeId: plan.conditionNode?.id ?? plan.emailNode.id,
  purpose: automation.purpose,
  prepared,        // subject, body, etc.
  plan,            // nodes for logging
  recipients,      // full list to email
};
```

Everything the worker needs is copied into the job so Redis does not need to re-query the full list (except what the worker updates in DB).

**Type:** `automation-queue.types.ts` → `UnpaidReminderBatchJob`

---

### Step 6 — Add job to Redis (BullMQ)

```typescript
const queueJobId = await this.queueService.addUnpaidReminderBatch(batch);
await this.executionService.setQueueJobId(execution.id, queueJobId);
```

**Queue name:** `automation`  
**Job name:** `unpaid-reminder-batch`

The worker (`automation-queue.processor.ts`) will later call `runUnpaidReminderBatch(batch)`.

---

### Step 7 — Return status to the caller

```typescript
return {
  status: await this.getExecutionStatus(execution.id),
};
```

API response includes `executionId`, `queued`, `totalRecipients`, `progressPercent: 0`, etc.

---

## Full flow diagram

```text
enqueueUnpaidReminderBatch(automation, options)
│
├─► buildExecutionPlan(automationId)
│       └─ nodes from DB → emailNode, conditionNode, sendToUnpaidOnly
│
├─► prepareFromEmailNode(emailNode.config)
│       └─ subject + body ready (not sent)
│
├─► getUnpaidCustomersForFunnel(funnelId)
│       └─ funnel_payment (pending/failed/cancelled) → customers[]
│       └─ if empty → null OR 400 (see skipIfNoRecipients)
│
├─► createExecution(..., status: queued, totalRecipients: N)
│       └─ row in automation_execution
│
├─► addUnpaidReminderBatch(batch)  ──► Redis
│       └─ setQueueJobId on execution
│
└─► return { status: getExecutionStatus(executionId) }


        ═══════════ Redis worker (later) ═══════════

runUnpaidReminderBatch(batch)
│
├─► markProcessing → status: running
├─► sendBulkToRecipients (Brevo)
├─► logs per customer
└─► markCompleted or markFailed → Pusher
```

---

## What this function does NOT do

| Not here | Where it happens |
|----------|------------------|
| Send emails | `runUnpaidReminderBatch` → `sendBulkToRecipients` |
| Check “automation active” | `startExecution` / `runCronTick` before enqueue |
| Check “already running” | Same — before enqueue |
| Pusher notifications | `markCompleted` / `markFailed` in execution service |
| Cron schedule setup | `automation-cron-scheduler.service.ts` |

---

## Common errors (from this function only)

| Message | Cause |
|---------|--------|
| Automation has no nodes | No nodes on automation |
| Flow must include an email node | Missing `email` type node |
| Flow condition must target customers who have not completed payment | Condition node does not match “unpaid” labels |
| No unpaid customers found for this funnel | Manual run, empty recipient list |
| (cron) returns `null` | Cron run, empty list — normal, logged only |

---

## Related files

| File | Role |
|------|------|
| `automation.service.ts` | `enqueueUnpaidReminderBatch`, `runUnpaidReminderBatch`, callers |
| `automation-flow.service.ts` | `buildExecutionPlan` |
| `automation-recipients.service.ts` | `getUnpaidCustomersForFunnel` |
| `automation-email.service.ts` | `prepareFromEmailNode` |
| `automation-execution.service.ts` | `createExecution`, `setQueueJobId` |
| `automation-queue.service.ts` | `addUnpaidReminderBatch` |
| `automation-queue.processor.ts` | Runs `runUnpaidReminderBatch` |
| `automation-queue.types.ts` | `UnpaidReminderBatchJob` shape |

Module overview: [README.md](./README.md)
