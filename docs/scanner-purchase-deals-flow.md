# Scanner purchase-deals API — detailed guide

## Overview

This document describes **exactly how** Dealioo handles staff attaching / collecting payment for deal(s) at the scanner for a guest.

| Item | Value |
|------|--------|
| **HTTP** | `POST /api/funnel-event/business/:businessId/guest/:customerId/purchase-deals` |
| **Example** | `POST /api/funnel-event/business/159/guest/255/purchase-deals` |
| **Auth** | JWT required |
| **Role** | Scanner role required (`requireScannerRole`) |
| **Access** | `RedemptionService.verifyBusinessAccess` |
| **Controller** | `FunnelEventController.purchaseDealsAtScanner` |
| **Service** | `FunnelEventService.purchaseDealsAtScanner` |
| **DTO** | `ScannerPurchaseDealsDto` |
| **HTTP status on success** | `200` |

### What this API is for

Staff confirms: **“This guest paid at the counter for these deal(s).”**

It either:

1. **Settles** an existing unpaid online checkout (`funnel_payment` pending), or  
2. **Creates** a fresh paid `orders` + `funnel_payment` row(s) for a counter sale.

Then it may issue/upgrade a coupon (only for unpaid online / signup passes), log a staff visit, and write business history.

### Related docs / APIs

| Path | Purpose |
|------|---------|
| This API | Attach deals + collect payment (Path B) |
| `POST /api/redemption/scan/:businessId` | QR redeem + collect unpaid (Path A) |
| `GET /api/funnel-event/business/:id/events` | Orders list that includes these scanner orders |

---

## Request

### Path params

| Param | Meaning |
|-------|---------|
| `businessId` | Business where payment is collected |
| `customerId` | Guest (customer) receiving the deal(s) |

### Body (`ScannerPurchaseDealsDto`)

```json
{
  "funnelIds": [10, 12],
  "purchaseMeans": "IN_PERSON",
  "orderSubtotal": 40.0,
  "extraItemsAmount": 5.0,
  "idempotencyKey": "optional-unique-key-at-least-8-chars"
}
```

| Field | Required | Rules | Purpose |
|-------|----------|-------|---------|
| `funnelIds` | **Yes** | Array of ints ≥ 1, min length 1 | Deal funnels to purchase / settle |
| `purchaseMeans` | **Yes** | `IN_PERSON` \| `REDEEMED` \| `SCANNED` | How staff recorded the action (echoed in response; included in idempotency hash) |
| `orderSubtotal` | No | number ≥ 0 | Must match **sum of campaign prices** (dollars) when sent |
| `extraItemsAmount` | No | number ≥ 0 | Extras (stored on visit as `orderSubtotal`, not added into payment amount) |
| `idempotencyKey` | No | string 8–128 chars | Safe retries; same key + same hash returns same result |

#### `purchaseMeans` values

| Value | Intended meaning |
|-------|------------------|
| `IN_PERSON` | Paid / collected at the counter |
| `REDEEMED` | Treated as a redemption-style attach |
| `SCANNED` | Recorded via QR / code scan path in UI |

**Note (current behavior):** payments are still stored with  
`payment_source = SCANNER`, `collection_channel = IN_STORE`, `payment_method = OTHER`  
regardless of `purchaseMeans`. The field is **validated**, stored in the **idempotency hash**, and **returned** on each purchased deal. It does not yet switch payment provenance columns.

---

## Response

```ts
type ScannerPurchasedDeal = {
  funnelId: number;
  campaignName: string;
  couponId: number | null; // null for fresh counter sale with no unpaid pass
  purchaseMeans: 'IN_PERSON' | 'REDEEMED' | 'SCANNED';
};
```

Example:

```json
[
  {
    "funnelId": 10,
    "campaignName": "Lunch Special",
    "couponId": 88,
    "purchaseMeans": "IN_PERSON"
  },
  {
    "funnelId": 12,
    "campaignName": "Coffee Deal",
    "couponId": null,
    "purchaseMeans": "IN_PERSON"
  }
]
```

---

## High-level pipeline

```text
POST purchase-deals
        │
        ▼
┌─────────────────────────────────────┐
│ Auth: JWT + scanner role + access   │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ Validate purchaseMeans, funnelIds,  │
│ amounts; dedupe funnelIds           │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ Idempotency replay? → return cached │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ Load customer + business + funnels  │
│ Validate campaign active + price    │
│ Optional orderSubtotal match        │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ TRANSACTION                         │
│  - advisory lock (business, guest)  │
│  - per deal: pending payment?       │
│      YES → settle (Case 1)          │
│      NO  → queue fresh (Case 2)     │
│  - Case 2: 1 order + N payments     │
│  - save idempotency stub            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ AFTER COMMIT (per deal)             │
│  - unpaid pass / settled checkout → │
│      track SIGNUP + PAYMENT → coupon│
│  - fresh sale → no coupon           │
│  - customer_visits (STAFF_LOOKUP)   │
│  - save idempotency response        │
│  - business history log             │
└─────────────────────────────────────┘
        │
        ▼
   ScannerPurchasedDeal[]
```

---

## Step-by-step (detailed)

### Step 0 — Controller guards

**File:** `funnel-event.controller.ts`

1. `AuthGuard('jwt')` — must be logged in.  
2. `requireScannerRole(req.user)` — must be a scanner-capable role.  
3. `verifyBusinessAccess(businessId, userId, roleName)` — user may act on this business.  
4. Calls `purchaseDealsAtScanner` with body + `staffUserId = req.user.id`.

---

### Step 1 — Validate purchase means & funnel list

- `purchaseMeans` must be one of `IN_PERSON` | `REDEEMED` | `SCANNED`.
- `funnelIds` deduped and sorted ascending.
- Empty list → `400 Select at least one deal.`

---

### Step 2 — Extra items & idempotency hash

- `extraItemsAmount` → `extraItemsCents` (only if &gt; 0).
- Negative extras → scanner invalid amount error.

**Request hash** (SHA-256 of JSON):

```json
{
  "customerId": 255,
  "funnelIds": [10, 12],
  "extraItemsCents": 500,
  "purchaseMeans": "IN_PERSON"
}
```

Used so the same `idempotencyKey` with a **different** payload is rejected as a conflict.

---

### Step 3 — Idempotency early return

If `idempotencyKey` is present:

1. Look up `scanner_purchase_requests` by `(businessId, idempotencyKey)`.
2. If found and `requestHash` matches → return stored `responseJson` (no double charge).
3. If found and hash **differs** → `409 DUPLICATE_PURCHASE`.

---

### Step 4 — Load & validate entities

| Entity | Check |
|--------|--------|
| Customer | Must exist |
| Business | Must exist |
| Each funnel | Exists, has campaign, `campaign.businessId` matches |
| Campaign | Not soft-deleted (`deletedAt`) |
| Campaign price | Finite number ≥ 0; summed into `expectedTotalCents` |

If `orderSubtotal` is sent, it must equal the sum of campaign prices (compared in cents).

`visitOrderSubtotalDollars` = extras only (if any), later stored on the visit — **not** on payment total.

---

### Step 5 — Transaction + advisory lock

```sql
SELECT pg_advisory_xact_lock(businessId, customerId);
```

Prevents two concurrent purchase-deals for the same guest/business from racing.

Inside the transaction, idempotency is checked again with a **pessimistic write** lock (handles concurrent first requests).

---

### Step 6 — Per deal: settle pending vs fresh sale

For each funnel:

#### Find pending `funnel_payment`

1. Latest `PENDING` for `(funnelId, businessId, customerId)` with row lock.  
2. Else latest `PENDING` for `(funnelId, businessId, customerEmail)` (guest email lowercased).

#### Case 1 — Pending online checkout found (`fromUnpaidOnlineCheckout = true`)

**Update `funnel_payment`:**

| Column | Value |
|--------|--------|
| `status` | `paid` |
| `paid_at` | now |
| `amount` | campaign price (cents) |
| `customer_id` | guest |
| `campaign_id` | deal campaign |
| `payment_source` | `SCANNER` |
| `collection_channel` | `IN_STORE` |
| `payment_method` | `OTHER` |
| `payment_collected_by` | staff user id |
| `payment_collected_at` | now |

**Orders:**

- If payment already has `order_id` → update that order to `paid`, `source = SCANNER`, amount, `paid_at`.
- Else → create new paid scanner order and set `payment.order_id`.

#### Case 2 — No pending payment → queue for fresh batch

Push onto `newOrderPayments` with amount cents. After the loop:

1. Create **one** `orders` row:
   - `status = paid`
   - `source = SCANNER`
   - `total_amount` = sum of fresh deal amounts
   - `currency = usd`
   - `paid_at = now`
2. Create **one** `funnel_payment` per fresh deal, all sharing that `order_id`, with the same SCANNER / IN_STORE / OTHER markers as Case 1.
3. Flag `fromUnpaidOnlineCheckout = false`.

---

### Step 7 — Persist idempotency stub

If `idempotencyKey` present, insert `scanner_purchase_requests` with empty `responseJson` (filled after side effects).

Return `{ orderId, deals }` from the transaction.

If the transaction returned `null` (lost race to another idempotent writer), reload and return cached response.

---

### Step 8 — Side effects after commit (per deal)

For each settled/created deal:

#### Coupon decision

```text
shouldIssueOrUpgradeCoupon =
  fromUnpaidOnlineCheckout
  OR (existing ACTIVE coupon with paymentStatus PENDING and not expired)
```

| Path | What happens | `couponId` in response |
|------|----------------|-------------------------|
| **Issue/upgrade** | `track(SIGNUP)` then `track(PAYMENT)` with `funnelPaymentId` → coupon issued/paid | coupon id |
| **Fresh counter sale** | Payment only — **no** coupon issued | `null` |

`track(SIGNUP)` uses `{ skipPendingOrder: true }` so it does not create another pending order.

`track(PAYMENT)` with paid status also drives automations / prepaid activity (`logPrepaidForOffer`) via the normal track pipeline when applicable.

#### Customer visit

If there are campaign ids from the deals:

- Prefer linking visit to the **first issued coupon** (skip if visit for that coupon already exists).
- Else create visit with `couponId = null`.
- Fields:
  - `source = STAFF_LOOKUP`
  - `orderId` = primary order from batch
  - `orderSubtotal` = extras dollars (or null)
  - `visitCampaigns` = all campaign ids in the purchase
  - `staffUserId`, `visitedAt`

#### Finalize idempotency

Update `scanner_purchase_requests.responseJson` with the purchased array.

#### Business history

`businessHistoryService.logScannerPurchase(...)` with guest name, deal names, amount label, coupon ids, staff actor. Failures are logged but do not always fail the whole purchase (caught locally).

If later side effects throw after payments committed, the error is logged and rethrown (payments already exist).

---

## Decision tree

```text
purchase-deals(guest, funnelIds, purchaseMeans)
        │
        ▼
  for each funnelId:
        │
        ├─ pending funnel_payment for guest+deal?
        │     YES → UPDATE payment → paid / SCANNER / IN_STORE
        │           UPDATE or INSERT orders → set payment.order_id
        │           flag: fromUnpaidOnlineCheckout = true
        │
        └─ NO → add to fresh batch
                  │
                  ▼ (after loop)
             INSERT 1 orders (total = sum)
             INSERT N funnel_payment (each deal, same order_id)
             flag: fromUnpaidOnlineCheckout = false
        │
        ▼
  for each deal:
        ├─ unpaid checkout OR unpaid online pass?
        │     YES → track SIGNUP + PAYMENT → coupon
        │     NO  → payment only, couponId null
        │
        ▼
  customer_visits (STAFF_LOOKUP) + history + idempotency response
```

---

## Tables written / updated

| Table | When |
|-------|------|
| `funnel_payment` | Settled pending **or** created paid scanner payment |
| `orders` | Updated/created paid scanner order(s) |
| `scanner_purchase_requests` | Idempotency request + response |
| `funnel_event` | Via `track(SIGNUP)` / `track(PAYMENT)` when coupon path runs |
| `coupons` | Issued/upgraded via track/coupon pipeline (coupon path only) |
| `customer_visits` (+ visit campaigns) | Staff lookup visit for the purchase |
| `activity_event` | Indirectly via payment track → prepaid / related logging |
| Business history | Scanner purchase event |

---

## Payment markers (always for this API today)

| Column / concept | Value |
|------------------|--------|
| `funnel_payment.payment_source` | `SCANNER` |
| `funnel_payment.collection_channel` | `IN_STORE` |
| `funnel_payment.payment_method` | `OTHER` |
| `orders.source` | `SCANNER` |
| `orders.status` (after collect) | `paid` |

These are what the Orders list and Activity “In person” logic treat as counter / scanner pay.

---

## Error cases (common)

| Situation | Result |
|-----------|--------|
| Not scanner role / no business access | Auth / forbidden |
| Missing / invalid `purchaseMeans` | Validation 400 |
| Empty `funnelIds` | 400 |
| Deal not for this business | 404 |
| Campaign deleted | `CAMPAIGN_INACTIVE` |
| Bad / mismatched amounts | `INVALID_AMOUNT` |
| Idempotency key reused with different body | `DUPLICATE_PURCHASE` 409 |
| Coupon path expected but coupon missing after track | 400 Could not issue pass |

---

## Frontend callers

| File | What it sends |
|------|----------------|
| `app/services/funnel/purchase-scanner-deals.ts` | HTTP client; requires `purchaseMeans` |
| `ScannerSearchGuestPanel.tsx` | Attach deals → `purchaseMeans: "IN_PERSON"` |
| `ScannerCreateGuestPanel.tsx` | Create guest + deals → `purchaseMeans: "IN_PERSON"` |

---

## Worked example

```http
POST /api/funnel-event/business/159/guest/255/purchase-deals
Authorization: Bearer <scanner JWT>
Content-Type: application/json

{
  "funnelIds": [10],
  "purchaseMeans": "IN_PERSON",
  "orderSubtotal": 25,
  "idempotencyKey": "purchase-abc-12345"
}
```

1. Staff + business 159 access OK.  
2. Funnel 10 belongs to business 159; price $25 matches `orderSubtotal`.  
3. Lock `(159, 255)`.  
4. If guest 255 had a pending payment for funnel 10 → mark paid + update/create order.  
   Else → create paid scanner order + payment.  
5. If unpaid online pass path → SIGNUP + PAYMENT → coupon id returned.  
   Else → `couponId: null`.  
6. Staff visit + history + cache response under idempotency key.  
7. Return `[{ funnelId, campaignName, couponId, purchaseMeans: "IN_PERSON" }]`.

---

## Mental model

```text
purchase-deals  =  “guest paid at counter for these deals”
orders          =  money / list row
funnel_payment  =  which deal + SCANNER / IN_STORE markers
coupon          =  only if settling unpaid online / signup pass
visit           =  staff lookup check-in (+ optional extras amount)
purchaseMeans   =  caller label (IN_PERSON / REDEEMED / SCANNED), echoed back
```

---

## Related code files

| File | Responsibility |
|------|----------------|
| `funnel-event.controller.ts` | Route, role, access, DTO → service |
| `funnel-event.service.ts` | `purchaseDealsAtScanner` full flow |
| `funnelEventDto/scanner-purchase-deals.dto.ts` | Body validation + `ScannerPurchaseMeans` |
| `scanner-purchase-request.entity.ts` | Idempotency table |
| `funnel-payment.entity.ts` | Payment provenance enums |
| `order.entity.ts` | Order source/status |
| Frontend `purchase-scanner-deals.ts` | Client payload |
