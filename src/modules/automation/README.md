# Automation module

This folder runs **payment-reminder style automations** (bulk email to unpaid funnel customers) and also supports **step-by-step workflows** (events, wait nodes, one customer at a time).

If you only care about **cron + Run button + bulk reminders**, follow **Path A** and the **Execution API** section below; ignore the engine until you need it.

---

## Table of contents

1. [Two execution paths](#two-execution-paths)
2. [Path A — Bulk reminder](#path-a--bulk-reminder)
3. [Path B — Step engine](#path-b--step-engine)
4. [Background jobs (BullMQ / Redis)](#background-jobs-bullmq--redis)
5. [Service split & file map](#service-split--file-map)
6. [Suggested reading order](#suggested-reading-order)
7. [Execution API — full flow](#execution-api--full-flow)
8. [Realtime (Pusher)](#realtime-pusher)

**Deep dive:** [enqueueUnpaidReminderBatch()](./ENQUEUE-UNPAID-REMINDER-BATCH.md)

---

## Two execution paths

| Path | When it runs | Entry points | Core code |
|------|----------------|--------------|-----------|
| **A — Bulk reminder** | Manual run, cron schedule | `POST /automation/execution`, cron → `runCronTick` | `AutomationBatchRunService`: `startExecution` / `runCronTick` → `enqueueUnpaidReminderBatch` → `runUnpaidReminderBatch` |
| **B — Step engine** | Funnel events, wait/delay nodes | `handleEvent`, `POST /automation/execution/:id/process`, `POST .../resume` | `AutomationEngineService` + jobs `process-execution`, `resume-execution` |

Path **A** is what most payment-reminder products use. Path **B** is for advanced flows (signup triggers, waits, per-customer steps).

---

## Path A — Bulk reminder

```text
┌─────────────────────────────────────────────────────────────────┐
│ Trigger                                                          │
│  • POST /automation/execution  (startExecution)                  │
│  • Cron every N minutes (runCronTick → same enqueue helper)      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Checks (automation-batch-run.service.ts → startExecution)        │
│  • Automation exists and isActive                                │
│  • funnelId set                                                  │
│  • No other execution already running for this automation        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ enqueueUnpaidReminderBatch                                       │
│  1. automation-flow.service → buildExecutionPlan (nodes)         │
│  2. automation-recipients.service → unpaid customers             │
│  3. automation-execution.service → create execution (QUEUED)   │
│  4. automation-queue.service → addUnpaidReminderBatch (Redis)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ automation-queue.processor                                       │
│  Job: unpaid-reminder-batch → runUnpaidReminderBatch             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Send + finish                                                    │
│  • automation-email.service (Brevo)                              │
│  • automation-log.service (per-step logs)                        │
│  • mark completed/failed → Pusher (automation-execution.service) │
└─────────────────────────────────────────────────────────────────┘
```

### `skipIfNoRecipients`

Shared flag on `enqueueUnpaidReminderBatch`:

| Caller | Value | If zero unpaid customers |
|--------|-------|---------------------------|
| Manual `startExecution` | `false` | `400` — "No unpaid customers found for this funnel" |
| Cron `runCronTick` | `true` | Return quietly; log "no unpaid recipients" |

---

## Path B — Step engine

```text
Funnel event (signup, payment, etc.)
        │
        ▼
handleEvent (automation-event.service.ts)
        │
        ▼
Queue: process-execution / resume-execution
        │
        ▼
AutomationEngineService.processExecution / resumeAfterWait
        │
        ▼
Runs one node at a time (trigger, email, condition, wait, …)
```

Use this when automations must react to **live funnel events** or pause on **wait** nodes—not for the simple "email all unpaid every 2 minutes" cron product.

---

## Background jobs (BullMQ / Redis)

| Job name | Handler | Path |
|----------|---------|------|
| `cron-tick` | `runCronTick` | A (may enqueue batch) |
| `unpaid-reminder-batch` | `runUnpaidReminderBatch` | A |
| `process-execution` | `AutomationEngineService.processExecution` | B |
| `resume-execution` | `AutomationEngineService.resumeAfterWait` | B |

Queue: `automation` (see `automation-queue.constants.ts`). Worker concurrency: 2 (`automation-queue.processor.ts`).

Cron schedules are registered in Redis by `automation-cron-scheduler.service.ts` when an automation is active and its first node is `trigger: cron`.

---

## Service split & file map

The controller injects **`AutomationService`** only (thin facade). Logic lives in:

| Service | Responsibility |
|---------|----------------|
| `automation-crud.service.ts` | Automations, nodes, connections, activate/deactivate |
| `automation-batch-run.service.ts` | Path A: bulk run, cron, execution list/status/logs (also used by queue processor) |
| `automation-event.service.ts` | Path B: `handleEvent`, process/resume queue triggers |

| File | Responsibility |
|------|----------------|
| `automation.controller.ts` | HTTP routes |
| `automation.service.ts` | Facade — delegates to the three services above |
| `automation-flow.service.ts` | Nodes → execution plan (email node, unpaid condition) |
| `automation-recipients.service.ts` | Unpaid customers for a funnel |
| `automation-email.service.ts` | Prepare/send email (Brevo) |
| `automation-email-renderer.service.ts` | Template rendering |
| `automation-execution.service.ts` | Execution rows, queue job id, terminal status, Pusher |
| `automation-log.service.ts` | Execution logs |
| `automation-queue.service.ts` | Enqueue jobs + cron scheduler upsert |
| `automation-queue.processor.ts` | Worker switch on job name |
| `automation-cron-scheduler.service.ts` | Sync cron jobs on startup / activate / node change |
| `automation-cron.config.ts` | Parse cron interval from first trigger node |
| `automation-engine.service.ts` | Path B node runner |
| `automation.module.ts` | Nest wiring + BullMQ |

DTOs live in `automationDto/`.

---

## Suggested reading order

1. `automation.controller.ts` — `POST execution`, activate/deactivate
2. `automation-batch-run.service.ts` — `startExecution`, `runCronTick`, `enqueueUnpaidReminderBatch`, `runUnpaidReminderBatch`
3. `automation-flow.service.ts` + `automation-recipients.service.ts`
4. `automation-queue.service.ts` + `automation-queue.processor.ts`
5. `automation-cron-scheduler.service.ts` (only if debugging cron)

Skip on first pass: `automation-event.service.ts`, `automation-engine.service.ts`, `executeAutomation` wrapper.

---

## Execution API — full flow

How **automation runs** (executions) work over HTTP: starting a run, checking progress, logs, and background processing.

**Base path:** `/automation`  
**Auth:** Execution routes use `AuthGuard('jwt')` — valid admin JWT required.

### Quick summary

1. Call **`POST /automation/execution`** with `automationId`.
2. Server checks automation is **active**, has a **funnel**, and is **not already running**.
3. Finds **unpaid customers**, creates an **execution** row (`queued`), enqueues a **BullMQ** job in Redis.
4. Worker sends emails, then marks run **`completed`** or **`failed`**.
5. Frontend **polls** `GET /automation/execution/:id/status` and/or listens on **Pusher**.

Cron uses the **same** enqueue logic but does **not** call this HTTP API.

### Execution statuses

| Status | Meaning |
|--------|---------|
| `queued` | Run created; waiting for worker |
| `running` | Worker sending emails (or engine processing) |
| `waiting` | Engine only — paused on wait node |
| `completed` | Finished successfully |
| `failed` | Error; see `lastError` on status |

Bulk reminders:

```text
queued  →  running  →  completed
                    ↘ failed
```

### API endpoints

#### Start a bulk run (main “Run” button)

**`POST /automation/execution`**

```json
{ "automationId": 5 }
```

Optional `currentNodeId` on the DTO is **not used** by the bulk path — start node comes from flow plan (first node by `order`).

**Success (`200`):**

```json
{
  "status": {
    "executionId": 42,
    "automationId": 5,
    "status": "queued",
    "isTerminal": false,
    "totalRecipients": 12,
    "emailsSent": 0,
    "progressPercent": 0,
    "queueJobId": "123",
    "lastError": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Use `status.executionId` for polling and Pusher channel `automation-execution-{executionId}`.

**Checks before enqueue:**

| Check | HTTP error |
|-------|------------|
| User is admin | 403 |
| Automation exists and `isActive: true` | 404 or 400 “not active” |
| Automation has `funnelId` | 400 “no funnel linked” |
| No run in `queued` / `running` / `waiting` for this automation | 409 conflict |
| Flow has email + unpaid condition | 400 |
| At least one unpaid customer | 400 “No unpaid customers…” |

#### Alternate start (signup reminder only)

**`POST /automation/:id/execute`** — same bulk pipeline when `purpose` = `funnel_signup_payment_reminder` and `trigger` = `signup`. Returns `ExecuteAutomationResponseDto`.

#### Other execution routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/automation/execution/:id/status` | Poll progress; stop when `isTerminal` |
| GET | `/automation/execution/:id` | Full execution + `executedRecipients` |
| GET | `/automation/execution` | List runs (`automationId`, `status`, `page`, `limit`) |
| GET | `/automation/execution/:id/logs` | Step logs for one run |
| DELETE | `/automation/execution/:id` | Delete finished run (409 if still active) |
| POST | `/automation/execution/:id/process` | Engine only — enqueue `process-execution` |
| POST | `/automation/execution/:id/resume` | Engine only — enqueue `resume-execution` |
| POST | `/automation/:id/activate` | Required before run |
| POST | `/automation/:id/deactivate` | Stops eligible runs |

Bulk reminders **do not** need `process` / `resume` — the worker runs `unpaid-reminder-batch` automatically.

### End-to-end: `POST /automation/execution`

```text
Frontend  →  AutomationController  →  AutomationService (facade)
       →  AutomationBatchRunService.startExecution
       →  Flow + Recipients + Email prepare
       →  AutomationExecutionService.createExecution (queued)
       →  AutomationQueueService.addUnpaidReminderBatch
       →  Redis / BullMQ
       →  AutomationQueueProcessor → runUnpaidReminderBatch
       →  Brevo bulk send + logs
       →  markCompleted / markFailed → Pusher
```

### Inside `enqueueUnpaidReminderBatch` (manual + cron)

1. `buildExecutionPlan` — email node required; unpaid condition detected
2. `getUnpaidCustomersForFunnel` — empty → error (manual) or skip (cron)
3. `createExecution` — `queued`, `totalRecipients`
4. `addUnpaidReminderBatch` + `setQueueJobId`
5. Return `getExecutionStatus` to API caller

### Inside `runUnpaidReminderBatch` (worker)

| Step | Action |
|------|--------|
| 1 | `markProcessing` → `running` |
| 2 | Log email node + condition |
| 3 | `sendBulkToRecipients` (Brevo) |
| 4 | Per recipient: logs + `incrementEmailsSentBy` |
| 5 | Error → `markFailed` + Pusher `execution-failed` |
| 6 | Success → `markCompleted` + Pusher `execution-completed` |

### Frontend checklist

1. `POST /automation/execution` with `{ automationId }`
2. Store `response.status.executionId`
3. Subscribe Pusher `automation-execution-{executionId}` (optional: `automation-{automationId}`)
4. Poll `GET /automation/execution/:id/status` until `isTerminal === true`
5. Details: `GET .../execution/:id` and `GET .../execution/:id/logs`
6. History: `GET /automation/execution?automationId=...`

### Cron vs HTTP

| Trigger | Entry | `skipIfNoRecipients` |
|---------|--------|------------------------|
| Run button / API | `POST /automation/execution` | `false` → 400 if no unpaid |
| Schedule | `runCronTick` → same enqueue | `true` → silent skip |

---

## Realtime (Pusher)

When a bulk run finishes or fails, `automation-execution.service.ts` notifies:

- Channel `automation-execution-{executionId}`
- Channel `automation-{automationId}`

Events: `execution-completed`, `execution-failed` (see `pusher` module).
