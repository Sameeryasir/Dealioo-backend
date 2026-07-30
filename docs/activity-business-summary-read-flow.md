# Activity business summary API — detailed read flow

## Overview

This document describes **exactly how** Dealioo builds the activity **summary** totals for a business (visited / redeemed / prepaid / messages).

| Item | Value |
|------|--------|
| **HTTP** | `GET /api/activity/business/:businessId/summary` |
| **Example** | `GET /api/activity/business/159/summary?from=2026-02-01T00:00:00.000Z&to=2026-07-30T14:20:20.031Z` |
| **Auth** | JWT required |
| **Access check** | `RedemptionService.verifyBusinessAccess` (caller must own/access the business) |
| **Controller** | `ActivityController.getBusinessSummary` |
| **Service** | `ActivityService.getBusinessSummary` |
| **Query DTO** | `GetBusinessActivityQueryDto` |
| **Primary table** | `activity_event` |

### What this API is for

It returns **counts** of activity events in a date range (dashboard summary cards), **not** the paginated activity feed list.

Related (separate) endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/activity/business/:businessId/events` | Paginated activity **feed** rows |
| `GET /api/activity/business/:businessId/summary` | **This doc** — totals by event type |
| `GET /api/activity/business/:businessId/summary/monthly` | Monthly time-series + snapshot metrics |

---

## Example request

```http
GET /api/activity/business/159/summary?from=2026-02-01T00:00:00.000Z&to=2026-07-30T14:20:20.031Z
Authorization: Bearer <JWT>
```

Meaning for business **159**:

- Count activity rows from **2026-02-01** through **2026-07-30** (UTC timestamps as given).
- Group by `event_type`.
- Return totals for visited, redeemed, prepaid, messages, plus overall `totalEvents`.

---

## Query parameters

Defined in `activityDto/get-business-activity-query.dto.ts`.

| Param | Type | Required | Allowed / notes | Purpose |
|-------|------|----------|-----------------|---------|
| `from` | ISO date string | No | e.g. `2026-02-01T00:00:00.000Z` | Range start (`occurred_at >= from`) |
| `to` | ISO date string | No | e.g. `2026-07-30T14:20:20.031Z` | Range end (`occurred_at <= to`) |
| `eventType` | string | No | See filters below | Narrow which event types are counted |
| `search` | string (max 120) | No | Accepted on DTO | **Not used** by summary (only by events feed) |

### `eventType` filter values

From `activity-filters.util.ts` → `ACTIVITY_EVENT_TYPE_FILTERS`:

| Value | Meaning for summary |
|-------|---------------------|
| *(omitted)* or `all` | Count all relevant types (after hide rules) |
| `visited` | Only `visited` |
| `redeemed_reward` | Only `redeemed_reward` |
| `prepaid_for_offer` | Only **online** prepaid (`prepaid_for_offer` **excluding** in-store) |
| `in_person` | Only **in-store** prepaid (`prepaid_for_offer` **matching** in-store SQL) |
| `message_sent` | Only `message_sent` |

---

## High-level pipeline

```text
Request (businessId, from, to, eventType?)
        │
        ▼
┌────────────────────────────────────────┐
│ 1. JWT + verifyBusinessAccess           │
└────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────┐
│ 2. Parse dates → resolveActivityDateRange │
└────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────┐
│ 3. SQL on activity_event:              │
│    WHERE business_id                   │
│      AND occurred_at in [from, to]     │
│      AND NOT (hidden staff visits)     │
│    GROUP BY event_type                 │
│    COUNT(*)                            │
└────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────┐
│ 4. Optional applyEventTypeFilter       │
│    (visited / redeemed / prepaid /     │
│     in_person / message_sent)          │
└────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────┐
│ 5. Map raw counts → ActivitySummary    │
└────────────────────────────────────────┘
        │
        ▼
   { totalEvents, totalVisited, ... from, to }
```

**In short:** read `activity_event` for the business + date range → hide some staff check-ins → group/count by type → return summary numbers.

---

## Step-by-step (detailed)

### Step 0 — Controller entry

**File:** `src/modules/activity/activity.controller.ts`

```ts
@Get('business/:businessId/summary')
async getBusinessSummary(businessId, query, req) {
  await this.redemptionService.verifyBusinessAccess(
    businessId,
    req.user.id,
    req.user.role.name,
  );

  const range = parseActivityQueryDates(query);

  return this.activityService.getBusinessSummary(businessId, {
    eventType: parseActivityEventTypeFilter(query.eventType),
    from: range.from,
    to: range.to,
  });
}
```

#### Access control

- Caller must be authenticated.
- `verifyBusinessAccess` ensures the user can access business `:businessId` (owner / allowed role). Otherwise the request fails before any query.

#### Date parsing

```ts
parseDate(raw) → Date | null   // invalid → null
parseActivityQueryDates(query) → resolveActivityDateRange(from, to)
```

`resolveActivityDateRange` (`activity-filters.util.ts`):

| Input | Result |
|-------|--------|
| `from` provided | Use that `Date` |
| `from` missing | Default: first day of month, **5 months back** in UTC (6-month window including current month) via `getDefaultActivityRangeStart(6)` |
| `to` provided | Use that `Date` |
| `to` missing | Now (`new Date()`) |

For the example URL both `from` and `to` are provided, so the default window is **not** used.

---

### Step 1 — Service: resolve range again

**Method:** `ActivityService.getBusinessSummary`

```ts
const range = resolveActivityDateRange(options.from, options.to);
```

Same helper as the controller (safe if dates already set).

---

### Step 2 — Build the SQL aggregate query

**Table:** `activity_event` (entity `ActivityEvent`)

```sql
SELECT
  activity.event_type AS "eventType",
  COUNT(*)            AS "count"
FROM activity_event activity
WHERE activity.business_id = :businessId
  AND activity.occurred_at >= :from
  AND activity.occurred_at <= :to
  AND NOT (
    activity.event_type = 'visited'
    AND (
      COALESCE(activity.metadata->>'visitSource', '') = 'STAFF_LOOKUP'
      OR activity.description ILIKE 'Checked in at%'
    )
  )
  -- optional eventType filter (see Step 3)
GROUP BY activity.event_type
```

#### Base filters explained

| Clause | Purpose |
|--------|---------|
| `business_id = :businessId` | Only this business (e.g. 159) |
| `occurred_at >= :from` | Inclusive range start |
| `occurred_at <= :to` | Inclusive range end |
| Hide staff-lookup visits | Exclude “fake” / staff-panel check-ins from visit totals |

**Hidden visited events** (still stored in DB, but **not counted** in summary):

1. `event_type = visited` **and** `metadata.visitSource = STAFF_LOOKUP`, **or**
2. `event_type = visited` **and** description starts like `Checked in at%`

So QR / real guest visits can still count; staff-lookup “checked in” rows do not inflate `totalVisited`.

---

### Step 3 — Optional `eventType` filter

**Method:** `applyEventTypeFilter(qb, eventType)`

Uses metadata/description SQL for prepaid channel split:

```sql
-- inStorePrepaidSql (conceptual)
(
  COALESCE(metadata->>'source', '') = 'scanner_purchase'
  OR COALESCE(metadata->>'paymentSource', '') = 'SCANNER'
  OR COALESCE(metadata->>'collectionChannel', '') = 'IN_STORE'
  OR description ILIKE '% at %'
)
```

| `eventType` | Extra WHERE |
|-------------|-------------|
| `null` / all | No extra filter |
| `in_person` | `event_type = prepaid_for_offer` **AND** in-store SQL |
| `prepaid_for_offer` | `event_type = prepaid_for_offer` **AND NOT** in-store SQL (online only) |
| `visited` / `redeemed_reward` / `message_sent` | `event_type = :eventType` |

**Business meaning:**

- Activity UI **“In person”** filter → counts scanner / counter prepaid events.
- Activity UI **“Prepaid”** filter → counts online Stripe-style prepaid events.
- Both are stored as `event_type = prepaid_for_offer`; channel is inferred from metadata/description.

---

### Step 4 — Map counts to response fields

Raw rows look like:

```ts
{ eventType: 'visited', count: '12' }
{ eventType: 'redeemed_reward', count: '5' }
...
```

Service initializes:

```ts
totalVisited = 0
totalRedeemed = 0
totalPrepaid = 0
totalMessagesSent = 0
```

Then switches on `eventType`:

| DB `event_type` | Summary field |
|-----------------|---------------|
| `visited` | `totalVisited` |
| `redeemed_reward` | `totalRedeemed` |
| `prepaid_for_offer` | `totalPrepaid` |
| `message_sent` | `totalMessagesSent` |
| anything else | ignored |

Finally:

```ts
totalEvents =
  totalVisited + totalRedeemed + totalPrepaid + totalMessagesSent
```

`from` / `to` in the response are ISO strings of the resolved range.

---

## Response shape

```ts
type ActivitySummary = {
  totalEvents: number;
  totalVisited: number;
  totalRedeemed: number;
  totalPrepaid: number;
  totalMessagesSent: number;
  from: string; // ISO
  to: string;   // ISO
};
```

### Example response

```json
{
  "totalEvents": 42,
  "totalVisited": 10,
  "totalRedeemed": 8,
  "totalPrepaid": 15,
  "totalMessagesSent": 9,
  "from": "2026-02-01T00:00:00.000Z",
  "to": "2026-07-30T14:20:20.031Z"
}
```

| Field | Meaning |
|-------|---------|
| `totalVisited` | Count of `visited` (excluding hidden staff check-ins) |
| `totalRedeemed` | Count of `redeemed_reward` |
| `totalPrepaid` | Count of `prepaid_for_offer` (online + in-store **unless** `eventType` narrows it) |
| `totalMessagesSent` | Count of `message_sent` |
| `totalEvents` | Sum of the four totals above |
| `from` / `to` | Echo of the range actually used |

---

## Activity event types (source of truth)

**Entity:** `src/db/entities/activity-event.entity.ts`  
**Table:** `activity_event`

| Enum | DB value | Typical when written |
|------|----------|----------------------|
| `VISITED` | `visited` | Guest visit / QR check-in activity |
| `REDEEMED_REWARD` | `redeemed_reward` | Pass/coupon redeemed |
| `PREPAID_FOR_OFFER` | `prepaid_for_offer` | Paid for offer (online Stripe **or** in-store/scanner) |
| `MESSAGE_SENT` | `message_sent` | Outbound guest message logged |

Important columns used by this API:

| Column | Role |
|--------|------|
| `business_id` | Scope to business |
| `event_type` | Group / count key |
| `occurred_at` | Date range filter |
| `metadata` | `visitSource`, `paymentSource`, `collectionChannel`, `source` for hide/channel rules |
| `description` | Fallback patterns (`Checked in at%`, `% at %`) |

Index used for range queries: `IDX_activity_event_restaurant_occurred` on `(business_id, occurred_at)`.

---

## How rows get into `activity_event` (context)

Summary only **reads** counts. Rows are written elsewhere, for example:

| Writer (service helpers) | Event type | Typical idempotency key |
|--------------------------|------------|-------------------------|
| `logVisited` | `visited` | `visited:coupon:{id}` |
| `logRedeemedReward` | `redeemed_reward` | `redeemed:coupon:{id}` |
| `logPrepaidForOffer` | `prepaid_for_offer` | `prepaid:payment:{id}` |
| `logMessageSent` | `message_sent` | caller-provided |

Idempotency unique index: `IDX_activity_event_idempotency` on `idempotency_key` — prevents double-counting the same real-world action if logged twice.

---

## Tables involved

| Table | Role in this API |
|-------|------------------|
| `activity_event` | **Only** table queried for summary counts |
| `business` / membership | Indirect via `verifyBusinessAccess` (not selected in the aggregate) |

Not used by this summary endpoint:

- `orders`
- `funnel_payment` (except that prepaid activity metadata may reference payment ids when rows were logged)
- `customer_visits` (visits in the feed come from activity rows, not a live join to visits here)

---

## Filters cheat sheet

```text
No eventType
  → count visited (+ hide staff) + redeemed + prepaid (all channels) + messages

eventType=visited
  → only visited (still hides staff-lookup / "Checked in at%")

eventType=redeemed_reward
  → only redeemed

eventType=prepaid_for_offer
  → only online prepaid (NOT in-store SQL)

eventType=in_person
  → only in-store prepaid (scanner / IN_STORE / description " at ")

eventType=message_sent
  → only messages
```

---

## Worked example (business 159)

Request:

```http
GET /api/activity/business/159/summary?from=2026-02-01T00:00:00.000Z&to=2026-07-30T14:20:20.031Z
```

1. Verify JWT user can access business `159`.
2. Range = Feb 1 2026 00:00 UTC → Jul 30 2026 14:20 UTC.
3. Query `activity_event` for `business_id = 159` in that range.
4. Exclude staff-lookup / “Checked in at…” visit rows from visit counts.
5. `GROUP BY event_type` + `COUNT(*)`.
6. Fill `totalVisited`, `totalRedeemed`, `totalPrepaid`, `totalMessagesSent`.
7. `totalEvents` = sum of those four.
8. Return JSON with echoed `from` / `to`.

---

## Mental model

```text
activity_event rows  =  the source of truth for guest activity feed + summary
summary API          =  COUNT by type in a date window
staff check-ins      =  stored but hidden from visit totals
prepaid              =  one DB type, two UI channels (online vs in_person)
```

---

## Related code files

| File | Responsibility |
|------|----------------|
| `activity.controller.ts` | Route, JWT, access check, date/type parse |
| `activity.service.ts` | `getBusinessSummary`, `applyEventTypeFilter`, hide SQL |
| `activityDto/get-business-activity-query.dto.ts` | Query validation |
| `activity-filters.util.ts` | Date range defaults, eventType parse |
| `activity-event.entity.ts` | Table + `ActivityEventType` enum |

---

## Difference vs events feed

| | Summary (`/summary`) | Events (`/events`) |
|--|----------------------|--------------------|
| Purpose | Totals / cards | Paginated list |
| Returns | Counts + date range | Row items + pagination meta |
| Uses `search` | No | Yes (name/email/description) |
| Uses `page` / `limit` | No | Yes |
| Same hide staff visits? | Yes | Yes (same pattern in `getBusinessEvents`) |
| Same prepaid online vs in_person split? | Yes (via `eventType`) | Yes |
