# Business funnel events API — detailed read flow

## Overview

This document describes **exactly how** Dealioo loads data for the business Orders / events list.

| Item | Value |
|------|--------|
| **HTTP** | `GET /api/funnel-event/business/:businessId/events` |
| **Example** | `GET /api/funnel-event/business/159/events?page=1&limit=10` |
| **Auth** | JWT required (`AuthGuard('jwt')`) |
| **Controller** | `FunnelEventController.getBusinessFunnelEvents` |
| **Service** | `FunnelEventService.getBusinessFunnelEvents` |
| **Query DTO** | `GetBusinessFunnelEventsQueryDto` |

### Critical note

The path is under `/funnel-event`, but this endpoint does **not** mainly read from the `funnel_event` table.

It builds a list from:

1. `orders` (primary source — **one UI row per order**)
2. `funnel_payment` (joined by `order_id`)
3. `customer_visits` (by `order_id` and/or via coupon → `funnel_payment_id`)

Plus meta counts from `campaigns` and `funnels`.

**In short:** `orders` → attach `funnel_payment` → attach `customer_visits` → filter / sort / paginate → return.

---

## Query parameters

Defined in `funnelEventDto/get-business-funnel-events-query.dto.ts`.

| Param | Type | Default | Allowed values | Purpose |
|-------|------|---------|----------------|---------|
| `page` | int ≥ 1 | `1` | — | Page number |
| `limit` | int 1–100 | `10` | — | Page size |
| `status` | string | `all` | `all`, `paid`, `not_paid` | Paid vs not-paid filter |
| `date` | string | `all` | `all`, `today`, `week`, `month` | Date window filter |
| `search` | string (max 120) | — | free text | Match guest name / email / phone / campaign name |

Example:

```http
GET /api/funnel-event/business/159/events?page=1&limit=10&status=paid&date=week&search=jane
Authorization: Bearer <JWT>
```

---

## High-level pipeline

```text
Request (businessId, page, limit, filters)
        │
        ▼
┌───────────────────────────────────────┐
│ 1. Count campaigns + funnels (meta)   │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 2. Backfill pending Stripe checkouts  │
│    (create order + link payment if    │
│     payment has no order_id yet)      │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 3. Count all non-deleted orders       │
│    → meta.allEventsTotal              │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 4. Load ALL non-deleted orders for    │
│    business (no SQL pagination yet)   │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 5. Load funnel_payment where          │
│    order_id IN (those orders)         │
│    Group by order_id                  │
│    Enrich campaign + customer         │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 6. Load customer_visits               │
│    - by order_id                      │
│    - by coupon.funnel_payment_id      │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 7. mapOrderToBusinessRow (1 row/order)│
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 8. In-memory filters: date → search   │
│    → status                           │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ 9. Sort by payment/visit/created date │
│    Slice page (skip / limit)          │
└───────────────────────────────────────┘
        │
        ▼
   { data, meta }
```

---

## Step-by-step (detailed)

### Step 0 — Controller entry

**File:** `src/modules/funnel-event/funnel-event.controller.ts`

```ts
@Get('business/:businessId/events')
getBusinessFunnelEvents(businessId, query) {
  return this.funnelEventService.getBusinessFunnelEvents(
    businessId,
    query.page ?? 1,
    query.limit ?? 10,
    query,
  );
}
```

- Parses `:businessId` as an integer.
- Passes pagination + filters into the service.

---

### Step 1 — Normalize inputs

**File:** `src/modules/funnel-event/funnel-event.service.ts` → `getBusinessFunnelEvents`

- `pagination = normalizePagination(page, limit)` → `{ page, limit, skip }`
- `statusFilter = filters.status ?? 'all'`
- `dateFilter = filters.date ?? 'all'`
- `search = normalizeBusinessFunnelEventSearch(filters.search)`  
  (trim; empty string becomes `undefined`)

---

### Step 2 — Meta counts (campaigns & funnels)

These are **not** the list rows; they only fill `meta`.

| Count | How |
|-------|-----|
| `campaignCount` | `campaignRepository.count({ where: { businessId } })` |
| `funnelCount` | Query `funnels` **inner join** `campaign` where `campaign.business_id = businessId` |

---

### Step 3 — Backfill pending online checkouts

**Method:** `backfillPendingOrdersForOpenCheckouts(businessId)`

**Why:** Some open Stripe checkouts may have a `funnel_payment` with **no** `order_id`. This list is order-based, so those would be invisible until an order exists.

**What it does:**

1. Find up to **200** recent `funnel_payment` rows for the business where:
   - `status` ∈ `pending` | `failed` | `cancelled`
   - `payment_source` = `STRIPE`
2. Skip if payment already has `order_id`, or missing `funnel_id`, or not treated as online.
3. Require a customer email; resolve `customer_id` by email if needed.
4. **Insert** a new `orders` row:
   - `status = pending`
   - `source = STRIPE`
   - `total_amount` = payment amount
   - `paid_at = null`
5. **Update** payment: set `order_id` to the new order.

After this, open online checkouts can appear in the list as unpaid/pending orders.

---

### Step 4 — Unfiltered order total

```ts
allEventsTotal = COUNT(orders)
  WHERE business_id = :businessId
    AND deleted_at IS NULL
```

Stored in `meta.allEventsTotal`.

**Note:** This is the count of **orders**, not `funnel_event` rows, and it is **not** reduced by status/date/search filters.

---

### Step 5 — Load all business orders

**Method:** `loadBusinessOrders(businessId)`

```sql
SELECT * FROM orders ord
WHERE ord.business_id = :businessId
  AND ord.deleted_at IS NULL
```

- Loads **all** matching orders into memory (pagination happens later after filters).
- Soft-deleted orders are excluded.

---

### Step 6 — Load payments grouped by order

**Method:** `loadPaymentsGroupedByOrderId(businessId, orderIds)`

1. If `orderIds` is empty → return empty map.
2. Query:

```sql
SELECT payment.*, funnel.*
FROM funnel_payment payment
LEFT JOIN funnel ON ...
WHERE payment.business_id = :businessId
  AND payment.deleted_at IS NULL
  AND payment.order_id IN (:orderIds)
```

3. **Enrich** each payment (`enrichPaymentsForBusinessOrders`):
   - Load related `campaigns` by `campaign_id`
   - Resolve `customer` (by `customer_id` and/or email)
4. Group into `Map<orderId, FunnelPayment[]>`.

Payments without `order_id` are skipped in the grouping loop (they should already be linked by the backfill step when applicable).

---

### Step 7 — Load visits

Two maps:

#### A) By order — `loadVisitsByOrderId`

```sql
SELECT * FROM customer_visits
WHERE business_id = :businessId
  AND order_id IN (:orderIds)
ORDER BY visited_at DESC
```

- Keeps the **latest** visit per `order_id`.
- Snapshot fields: `visitId`, `orderSubtotal` (dollars), `visitedAt`.

#### B) By payment — `loadVisitsByFunnelPaymentId`

```sql
SELECT visit.*, coupon.*
FROM customer_visits visit
INNER JOIN coupons coupon ON ...
WHERE visit.business_id = :businessId
  AND coupon.funnel_payment_id IN (:paymentIds)
  AND visit.deleted_at IS NULL
ORDER BY visit.visited_at DESC
```

- Keeps the **latest** visit per `funnel_payment_id` (via coupon).
- Used when visit is tied to the payment/pass rather than directly to the order.

---

### Step 8 — Build one UI row per order

**Method:** `mapOrderToBusinessRow(order, payments, visitByPaymentId, visitForOrder)`

#### 8.1 Choose primary payment

- Sort payments by `paidAt ?? createdAt` **newest first**.
- `primary = sortedPayments[0]` (or `null` if no payments).

#### 8.2 Collect campaign names

- Walk all payments; collect unique campaign names (from payment.campaign or payment.funnel.campaign).
- Joined with `", "` on the row; fallback `"Order"`.

#### 8.3 Visit / business amount

- Prefer order-level visit `orderSubtotal` if &gt; 0.
- Else sum payment-linked visit subtotals (dedupe by `visitId`).
- `businessAmount` = that total in **dollars** (rounded to 2 decimals).
- `businessVisitedAt` from order visit or first payment visit.

#### 8.4 Online amount

```text
onlineAmountCents =
  order.totalAmount > 0
    ? order.totalAmount
    : sum(paid payment.amount)
```

#### 8.5 Paid flags & orderStatus

| Condition | `orderStatus` |
|-----------|----------------|
| Online paid **and** visit amount &gt; 0 | `paid_both` |
| Online paid only | `paid_online` |
| Visit amount only | `paid_walk_in` |
| Neither | `not_paid` |

- `anyPaid` = order status is `paid` **or** any payment status is `paid`.
- `paymentStatus` on the row = `paid` if `anyPaid`, else primary payment status.
- `paidAt` = `order.paidAt ?? primary.paidAt ?? order.createdAt` when paid; else `null`.

#### 8.6 Output row fields

| Field | Source / meaning |
|-------|------------------|
| `id` | `order.id` |
| `rowKey` | `order:{order.id}` |
| `eventType` | Always `PAYMENT` (funnel event type enum) |
| `createdAt` | `paidAt ?? order.createdAt` |
| `funnelId` | Primary payment’s funnel |
| `campaignId` | Primary payment’s campaign |
| `campaignName` | Joined unique campaign names |
| `customer` | Primary payment’s customer `{ id, name, email, phone }` |
| `customerEmail` | Customer email or payment `customer_email` |
| `amount` | Online amount in **cents** (or null) |
| `currency` | Order / payment currency (default `usd`) |
| `paymentStatus` | Paid or primary status |
| `receiptUrl` | First non-empty payment receipt URL |
| `orderStatus` | `not_paid` / `paid_online` / `paid_walk_in` / `paid_both` |
| `onlineAmountCents` | Online paid cents (or null) |
| `businessAmount` | Visit subtotal dollars (or null) |
| `businessVisitedAt` | Visit timestamp when business amount present |
| `paidAt` | When considered paid |
| `funnelPaymentId` | Primary payment id |
| `paymentCollectedAt` | Order paidAt or latest payment collected at |
| `orderId` | `order.id` |
| `paymentSource` | Primary payment source (`STRIPE`, `SCANNER`, etc.) |

---

### Step 9 — In-memory filters

Applied **after** all rows are built (not in SQL).

#### 9.1 Date filter — `matchesBusinessFunnelEventDateFilter`

Uses sort date = `paidAt` → else `businessVisitedAt` → else `createdAt`.

| `date` | Window start |
|--------|----------------|
| `all` | No filter |
| `today` | Local midnight today |
| `week` | Start of current week (Sunday = day 0) |
| `month` | First day of current month |

Keep row if sort date ≥ window start.

#### 9.2 Search filter

If `search` is set, keep row when lowercase haystack contains the term:

- customer name  
- customer email  
- customer phone  
- `customerEmail`  
- `campaignName`

#### 9.3 Status filter — `matchesBusinessEventStatusFilter`

First resolve **display status** via `resolveBusinessEventDisplayStatus`:

| Logic | Display status |
|-------|----------------|
| paymentStatus refunded / partially_refunded | `refunded` |
| failed / cancelled | `failed` |
| pending | `pending` |
| paid **or** orderStatus `paid_walk_in` / `paid_both` | `paid` |
| else | `pending` |

Then:

| Filter | Keeps |
|--------|--------|
| `all` | Everything |
| `paid` | display status === `paid` |
| `not_paid` | display status !== `paid` |

---

### Step 10 — Sort & paginate

**Sort:** `sortBusinessFunnelEventsByPaymentDate`  
Newest first by the same sort date (`paidAt` → `businessVisitedAt` → `createdAt`).

**Paginate:**

```ts
total = sortedRows.length          // after filters
data  = sortedRows.slice(skip, skip + limit)
```

`meta.total` = filtered count (not `allEventsTotal`).

---

### Step 11 — Response

```json
{
  "data": [ /* page of mapped order rows */ ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false,
    "campaignCount": 3,
    "funnelCount": 5,
    "allEventsTotal": 50
  }
}
```

Exact pagination meta fields come from `buildPaginationMeta` (`src/common/pagination`).

| Meta field | Meaning |
|------------|---------|
| `total` | Rows **after** status/date/search filters |
| `allEventsTotal` | All non-deleted orders for the business (unfiltered) |
| `campaignCount` | Campaigns for the business |
| `funnelCount` | Funnels for the business |

---

## Tables & columns involved

| Table | Role in this API |
|-------|------------------|
| `orders` | Main list identity; amount/currency/status/source/paid_at |
| `funnel_payment` | Guest, campaign, funnel, payment status, receipt, source, link via `order_id` |
| `customer_visits` | In-person / visit subtotal and visit time |
| `coupons` | Bridge visit → `funnel_payment_id` |
| `customers` | Guest profile on the row |
| `campaigns` | Campaign name + meta count |
| `funnels` | Funnel link on payment + meta count |
| `funnel_event` | **Not** the primary source for this list |

---

## Related code files

| File | Responsibility |
|------|----------------|
| `funnel-event.controller.ts` | Route + JWT guard |
| `funnel-event.service.ts` | `getBusinessFunnelEvents`, loaders, `mapOrderToBusinessRow`, backfill |
| `funnelEventDto/get-business-funnel-events-query.dto.ts` | Query validation |
| `business-funnel-events-filters.util.ts` | Date / status / search / sort helpers |
| `business-order-payment.util.ts` | `BusinessOrderPaymentStatus` type helpers (if used) |

Helper methods in the service:

- `loadBusinessOrders`
- `loadPaymentsGroupedByOrderId`
- `enrichPaymentsForBusinessOrders`
- `loadVisitsByOrderId`
- `loadVisitsByFunnelPaymentId`
- `mapOrderToBusinessRow`
- `backfillPendingOrdersForOpenCheckouts`

---

## Example for business 159

```http
GET /api/funnel-event/business/159/events?page=1&limit=10
```

1. Ensure open Stripe payments without orders get a pending order.
2. Load every non-deleted order for business `159`.
3. Attach payments + visits.
4. Build one row per order.
5. (No extra filters if only page/limit sent.)
6. Sort newest payment/visit first.
7. Return rows `0..9` plus meta counts.

---

## Mental model

```text
Orders table  =  the list
Payments      =  who / which deal / paid or not / Stripe vs scanner
Visits        =  in-person amount & visit time
Filters/sort  =  applied in memory after join
Page/limit    =  slice at the end
```

This is why a payment that never got an `orders` row (and was not backfilled) will **not** show up on this endpoint, even if `funnel_payment` or `funnel_event` exists.
