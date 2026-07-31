# Same-funnel registration — how the DB stores records

This document covers:

1. What is stored when a guest **registers on a funnel but has not paid yet**
2. What happens if they **register again on the same funnel** (same email)

---

## Rule in one line

**Email = guest identity.**  
Same email → same `customers` row (name/phone updated only if changed).  
Unpaid signup still creates funnel / activity / pending payment records (with idempotency on several tables).  
**Same email + same funnel + still Payment Pending** → update that pending’s time; still **one** unpaid offer.

---

## A) Signup completed — **not paid yet**

Typical guest path:

```text
Landing → Signup form submit
  1. POST create/register customer
  2. POST /funnel-event/track  (eventType = signup)
  3. (prepaid) create checkout session → may also create/link Stripe checkout later
```

Backend `FunnelEventService.track(signup)` then writes related rows.

### Step-by-step: what gets created

| Order | Table | What happens (unpaid) |
|------:|--------|------------------------|
| 1 | `customers` | Create new guest **or** reuse existing by email |
| 2 | `business_customers` | Link guest ↔ business (if `businessId` present) |
| 3 | `funnel_event` | One row: `event_type = signup`, `funnel_id`, `customer_id` |
| 4 | `customer_journey_events` | Signup step (idempotent per funnel + customer) |
| 5 | `customer_activity` | `ONLINE_SIGNUP` activity (idempotent per funnel + customer) |
| 6 | `funnel_payment` | **Pending** online payment for campaign price (if not already paid) |
| 7 | `funnel_order` (orders) | **Pending** order linked to that payment (`order_id` on payment) |
| 8 | Coupons / QR email | May issue signup coupon + schedule QR email (campaign rules) |

**Not created yet on unpaid signup:**

- Paid `funnel_event` (`event_type = payment` with paid status)
- `customer_activity` `ONLINE_PURCHASE`
- Journey **payment** step
- `paid_at` on payment / order

---

### Example tables — registered, **not paid**

Guest: `sameeryasir02@gmail.com` · Business `159` · Funnel `28` · Campaign `239` · `$12.00`

#### `customers`

| id | name | email | phone |
|----|------|-------|-------|
| 255 | Sameer Yasir | sameeryasir02@gmail.com | +923329927360 |

#### `business_customers`

| business_id | customer_id |
|-------------|-------------|
| 159 | 255 |

#### `funnel_event`

| id | event_type | funnel_id | customer_id | funnel_payment_id | payment_status |
|----|------------|-----------|-------------|-------------------|----------------|
| 309 | **signup** | 28 | 255 | null | null / unpaid |

One logical signup row per **funnel + customer** (see section B if they sign up again).

#### `customer_activity`

| activity_type | business_id | customer_id | source | idempotency_key (concept) |
|---------------|-------------|-------------|--------|---------------------------|
| **ONLINE_SIGNUP** | 159 | 255 | ONLINE | `activity:signup:funnel:28:customer:255` |

Metadata typically includes `funnelId`, `campaignId`, `funnelEventId`, label like “Signed up for deal”.

#### `customer_journey_events` (journey signup step)

| step | funnel_id | customer_id | campaign_id | idempotency_key (concept) |
|------|-----------|-------------|-------------|---------------------------|
| **SIGNUP** | 28 | 255 | 239 | `journey:signup:funnel:28:customer:255` |

#### `funnel_payment` (pending — not paid)

| id | status | amount | currency | collection_channel | payment_method | customer_id | funnel_id | campaign_id | order_id |
|----|--------|--------|----------|--------------------|----------------|-------------|-----------|-------------|----------|
| 505 | **pending** | 1200 | usd | ONLINE | ONLINE_CARD | 255 | 28 | 239 | 71 |

#### Orders table (`funnel_order` / order entity)

| id | status | source | total_amount | currency | paid_at |
|----|--------|--------|--------------|----------|---------|
| 71 | **PENDING** | STRIPE | 1200 | usd | null |

Payment row points at this order via `order_id`.

---

### Unpaid signup — summary picture

```text
customers (1)
    └─ business_customers (link to business)
    └─ funnel_event          [signup]
    └─ customer_activity     [ONLINE_SIGNUP]
    └─ customer_journey      [SIGNUP step]
    └─ funnel_payment        [pending] ──► order [PENDING]
```

Orders Activity UI can show this guest as **Payment Pending** using the pending payment / signup aggregate.

---

## B) Same guest registers **again** on the same funnel (same email)

### `customers`

| Result | Detail |
|--------|--------|
| Same row | Same `id` (email match) |
| Name/phone | Updated only if new values differ |
| Email | Unchanged |

### `funnel_event`

For the **same funnel + same customer**, signup tracking **reuses** the existing row (updates it) instead of inserting a second signup row.

| Result | Detail |
|--------|--------|
| Same `funnel_event` id | `event_type` stays `signup` |
| Automation on re-track | Usually **not** re-triggered (`shouldRunAutomation: false`) |

### `customer_activity` / journey

Idempotency keys are per funnel + customer, so a second signup **does not** create a second `ONLINE_SIGNUP` / journey signup row.

### `funnel_payment` / order

| Situation | Result |
|-----------|--------|
| Already **paid** for this funnel/customer | Does **not** block a new unpaid offer: if no pending exists, signup creates a new pending payment + order; if pending exists, that pending is bumped |
| Still unpaid, pending payment already exists | **Reuses** that same pending payment + linked order — **does not** create a second unpaid offer. Refreshes `updated_at` on **payment and order** (same idea as signup event bump) so Orders Activity shows the **latest signup time** |
| Guest later starts a **new Stripe checkout** from the UI | Can attach/update checkout session fields on payment flow (separate from the initial signup pending seed) |

**Product rule (current):** same email + same funnel + still Payment Pending → one unpaid offer, bumped to the new time.

---

## C) After they **pay** (for contrast — not unpaid)

When payment succeeds, additional writes typically include:

| Table | Change |
|--------|--------|
| `funnel_payment` | `status = paid`, `paid_at` set |
| `funnel_event` | Payment event / paid status linked to `funnel_payment_id` |
| `customer_activity` | `ONLINE_PURCHASE` (and related) |
| Journey | Payment step recorded |
| Order | Marked paid |

---

## Quick reference

| Question | Unpaid signup answer |
|----------|----------------------|
| Customer created? | Yes (or reused by email) |
| `funnel_event` signup? | Yes |
| `customer_activity` signup? | Yes (`ONLINE_SIGNUP`) |
| Journey signup step? | Yes |
| `funnel_payment`? | Yes — **pending** (if not already paid) |
| Order? | Yes — **PENDING**, linked from payment |
| Purchase activity? | **No** until paid |
| 2nd signup same funnel = 2nd signup event row? | **No** — same funnel+customer row is updated |
| 2nd signup = 2nd activity row? | **No** — idempotent |
| 2nd signup while still Payment Pending? | **Same** pending payment/order; `updated_at` bumped (still one unpaid offer) |

---

## Related code (for developers)

- Customer create/reuse: `customer.service.ts` → `registerCustomer`
- Signup track + pending payment/order: `funnel-event.service.ts` → `track` / `trackSignup` / `ensurePendingOrderForUnpaidFunnelSignup`
- Activity: `customer-activity.service.ts` → `recordOnlineSignup`
- Journey: `customer-journey.service.ts` → `recordSignup`
- Frontend signup submit: `TemplatePreview.tsx` (create customer → track signup → checkout)
- Orders Activity API: `GET /api/funnel-event/business/:businessId/events`
