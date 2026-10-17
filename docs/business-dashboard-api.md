# Business dashboard API audit

This report describes how the **business** dashboard loads numbers today. It follows the code in:

- `activity.controller.ts` / `activity.service.ts`
- `funnel-event.controller.ts` (`performance/top-campaigns`)
- `BusinessActivityOverviewPanel.tsx` / `BusinessDashboardTopCampaigns.tsx`

It does not include measured query plans. PostgreSQL chooses the plan at runtime, so “uses an index” below means the query shape can use the listed index, not that `EXPLAIN` was run on a live database.

The business dashboard is **not** the same as the campaign dashboard. The campaign screen is scoped to one funnel. The business screen is scoped to one `businessId` and rolls up activity, payments, members, and campaign earnings across that business.

---

## What the screen calls

The business overview (`BusinessActivityOverviewPanel`) and top-campaigns card call these APIs. The global prefix is `/api`. Every route below requires a logged-in user (JWT). Activity routes also check business access through `RedemptionService.verifyBusinessAccess`. Top campaigns require Admin or Super Admin and an accessible business.

| When | API the screen calls | Purpose |
| --- | --- | --- |
| Main KPIs + charts | `GET /api/activity/business/:businessId/summary/monthly?from&to&previousFrom&previousTo&timezone` | Period summary: visits, orders, revenue, members, new/returning/paying guests, hour or day buckets |
| Peak month highlight | `GET /api/activity/business/:businessId/summary/monthly?months=12` | Last 12 UTC months for “peak month” |
| Top earning campaigns | `GET /api/funnel-event/business/:businessId/performance/top-campaigns?from&to&limit&timezone` | Ranked campaigns by net paid earnings for the selected month |
| Meta ad spend (month view) | `GET /api/facebook-campaigns/business/:businessId/meta-spend?...` | External Meta spend. Not funnel SQL. |
| Google ad spend (month view) | `GET /api/google-ads/business/:businessId/google-spend?...` | External Google spend. Not funnel SQL. |

Related routes that exist but are **not** the main overview tiles:

| API | Purpose |
| --- | --- |
| `GET /api/activity/business/:businessId/summary?from&to&eventType` | Simple activity counts from `activity_event` only |
| `GET /api/activity/business/:businessId/events?...` | Paginated activity feed |
| `GET /api/activity/business/:businessId/customers/:customerId/timeline` | One guest timeline |
| `GET /api/funnel-event/business/:businessId/events?...` | Business orders / funnel events list (orders permission) |

Shared query parameters for the monthly summary:

| Param | Used for |
| --- | --- |
| `from`, `to` | Selected period. When both are valid, the handler calls `getBusinessSummaryForRange`. |
| `previousFrom`, `previousTo` | Comparison period. Loaded in parallel as a second cached range job. |
| `timezone` | Chart buckets. Same calendar day uses hours. A longer range uses days. |
| `months` | Used when `from`/`to` are missing. Builds the last N calendar months in UTC. |

---

## How a request is cached

### Activity monthly / range summary

`getBusinessSummaryMonthly` and `getBusinessSummaryForRange` use `activityStatsQueueService.getOrCompute`:

1. Read Redis for the cache key.
2. If present and older than the fresh window, return it and enqueue a background refresh.
3. On a miss, enqueue a BullMQ `activity-stats` job and wait for the result.
4. If the queue wait fails, compute inline and write Redis.

Cache keys look like:

- `activity-monthly-v5:{businessId}:{monthCount}`
- `activity-range-v15:{businessId}:{fromIso}:{toIso}:{timezone}`

Previous period uses its own range key and is fetched in parallel with the current period.

### KPI snapshot (active campaigns + today’s revenue)

`getDashboardKpiSnapshot` uses the in-memory `dashboardTtlCache` for 60 seconds (`DASHBOARD_CACHE_TTL_MS`):

`activity-kpi-v1:{businessId}:{todayStartUtc}`

### Top earning campaigns

`getBusinessTopEarningCampaigns` uses the in-memory `dashboardTtlCache` for 60 seconds:

`perf-top-campaigns-v7:{businessId}:{from}:{to}:{limit}:{timezone}`

---

## Tables the dashboard reads

| Table | Role on the business dashboard |
| --- | --- |
| `activity_event` | Visits, redemptions, prepaid offers, messages, signups. Source for check-ins, scanned vs in-store visits, prepaid revenue metadata, new/returning guest touches. |
| `funnel_payment` | Paid orders and revenue for the business. Split into online vs in-store. Also used for paying guests and lifetime order count. |
| `customers` | Member counts by `created_at`. There is **no** `business_id` on customers; membership is inferred. |
| `campaigns` | Active (published) campaign count; campaign name/type/image/price on top earners. |
| `funnels` | Join path from analytics and signup events to a campaign. |
| `funnel_event` | Signup counts per campaign on the top-campaigns card. |
| `funnel_analytics_event` | Distinct page-view style “views” per campaign on top campaigns. |
| `customer_visits` | Part of “who belongs to this business” and used to exclude some in-store addon-only payments from performance earnings. |
| `conversation` | Part of “who belongs to this business” for member totals. |

The business dashboard does **not** join Meta/Google spend tables for the main KPIs. Spend comes from separate ad APIs.

---

## What the headline numbers mean

These rules come from `ActivityService` and the performance helpers.

### Activity / overview tiles

- **Visited** — `activity_event` rows with `event_type = visited`.
- **Scanned visits** — visited rows whose metadata `visitSource` is QR redemption, or whose description starts with `scanned`.
- **In-store visits** — visited rows whose metadata `visitSource` is staff lookup, or whose description starts with `checked in`.
- **Redeemed reward** — `event_type = redeemed_reward`.
- **Check-ins** — visited + redeemed (computed in application code).
- **Prepaid for offer** — `event_type = prepaid_for_offer`.
- **Message sent** — `event_type = message_sent`.
- **Prepaid revenue cents** — sum of `metadata.amountCents` on prepaid events.
- **Extra items revenue cents** — sum of `metadata.extraItemsCents` on prepaid events, excluding `counterExtrasOnly = true`.
- **Orders** — count of `funnel_payment` rows for the business with `status = paid` in the range (by `COALESCE(paid_at, created_at)`).
- **Funnel orders** — paid payments that are **not** scanner / in-store channel.
- **In-store orders** — paid payments where `payment_source = SCANNER` or `collection_channel = IN_STORE`.
- **Paid revenue cents** — `SUM(amount)` of those paid payments (raw amount, not net of refunds).
- **Members** — distinct customers linked to the business whose `customers.created_at` falls in the bucket. Linkage is a union of activity, conversation, visits, paid payments by customer id, and legacy paid payments matched by email.
- **Funnel members** — members who also have a `signed_up` activity event for the business.
- **Restaurant members** — members without that signup activity.
- **New guests** — distinct customers with a visit/redeem/signup/prepaid touch in the range who have **no** earlier touch of those types before `from`.
- **Returning guests** — distinct customers with a touch in the range who **do** have an earlier touch before `from`.
- **Paying guests** — distinct customers with a paid `funnel_payment` in the range, union customers with prepaid activity that has `extraItemsCents > 0`.
- **Active campaigns** — count of published campaigns for the business (snapshot, not limited to the selected chart range).
- **Today revenue cents** — sum of paid `funnel_payment.amount` since UTC midnight today (snapshot).
- **Total orders / total members** on the monthly (`months=N`) path are lifetime-style snapshot counts. On the date-range path they are the **sum of the bucket series** for that response.

### Top earning campaigns

- Earnings use **net** cents: `GREATEST(0, amount - refunded_amount)`.
- Payments included: `status` in `paid` or `partially_refunded`, with a non-null `campaign_id`, joined to a non-deleted campaign for that business.
- Excluded: payments flagged as counter-extras-only via `activity_event.metadata`, and some in-store scanner payments that match visit addon lines only.
- Views: distinct visitors/sessions on `funnel_analytics_event` page views joined through funnel → campaign.
- Signups: count of `funnel_event` signup rows joined through funnel → campaign.

---

## API calls, tables, and queries

`$1` is the business id unless a query says otherwise. `$2`/`$3` are typically `from`/`to`.

### 1) `GET /api/activity/business/:businessId/summary/monthly` (with `from` + `to`)

Handler: `getBusinessSummaryForRange` → `computeBusinessSummaryForRange`.

**Access:** JWT + `verifyBusinessAccess(businessId)`.

**DB operations (current period, in parallel):**

| Step | Operation | Tables |
| --- | --- | --- |
| KPI snapshot | `COUNT` published campaigns; `SUM` today’s paid payments | `campaigns`, `funnel_payment` |
| Activity series | Aggregate activity by hour/day bucket | `activity_event` |
| Order series | Aggregate paid payments by bucket | `funnel_payment` |
| Member series | Aggregate linked customers by `created_at` bucket | `customers` (+ subqueries on `activity_event`, `conversation`, `customer_visits`, `funnel_payment`) |
| New vs returning | Distinct engaged guests + lateral prior touch | `activity_event` |
| Paying guests | Union of paid payers and prepaid extras | `funnel_payment`, `activity_event` |

If previous dates are present, the same range compute runs again for that window (separate cache key) and is attached as `previous`.

#### KPI snapshot (cached 60s in memory)

```sql
SELECT COUNT(*) FROM campaigns
WHERE business_id = $1 AND status = 'published';

SELECT COALESCE(SUM(payment.amount), 0) AS revenue
FROM funnel_payment payment
WHERE payment.business_id = $1
  AND payment.status = 'paid'
  AND COALESCE(payment.paid_at, payment.created_at) >= :todayStartUtc;
```

#### Activity series (shape)

```sql
SELECT
  bucket(activity.occurred_at) AS month,
  COUNT(*) FILTER (WHERE activity.event_type = 'visited') AS visited,
  COUNT(*) FILTER (WHERE /* scanned visit predicates */) AS "scannedVisits",
  COUNT(*) FILTER (WHERE /* in-store visit predicates */) AS "inStoreVisits",
  COUNT(*) FILTER (WHERE activity.event_type = 'redeemed_reward') AS "redeemedReward",
  COUNT(*) FILTER (WHERE activity.event_type = 'prepaid_for_offer') AS "prepaidForOffer",
  COUNT(*) FILTER (WHERE activity.event_type = 'message_sent') AS "messageSent",
  COALESCE(SUM(CASE WHEN activity.event_type = 'prepaid_for_offer'
    THEN NULLIF(activity.metadata->>'amountCents', '')::int ELSE 0 END), 0) AS "prepaidRevenueCents",
  /* extraItemsCents sum excluding counterExtrasOnly */
FROM activity_event activity
WHERE activity.business_id = $1
  AND activity.occurred_at >= $2
  AND activity.occurred_at <= $3
GROUP BY 1;
```

#### Order series (shape)

```sql
SELECT
  bucket(COALESCE(payment.paid_at, payment.created_at)) AS month,
  COUNT(*) AS orders,
  COUNT(*) FILTER (WHERE NOT (
    payment.payment_source = 'SCANNER'
    OR payment.collection_channel = 'IN_STORE'
  )) AS "funnelOrders",
  COUNT(*) FILTER (WHERE
    payment.payment_source = 'SCANNER'
    OR payment.collection_channel = 'IN_STORE'
  ) AS "inStoreOrders",
  COALESCE(SUM(payment.amount), 0) AS "paidRevenueCents"
FROM funnel_payment payment
WHERE payment.business_id = $1
  AND payment.status = 'paid'
  AND COALESCE(payment.paid_at, payment.created_at) >= $2
  AND COALESCE(payment.paid_at, payment.created_at) <= $3
GROUP BY 1;
```

#### New vs returning guests

```sql
SELECT
  COUNT(*) FILTER (WHERE prior.customer_id IS NULL)::int AS "newGuests",
  COUNT(*) FILTER (WHERE prior.customer_id IS NOT NULL)::int AS "returningGuests"
FROM (
  SELECT DISTINCT activity.customer_id
  FROM activity_event activity
  WHERE activity.business_id = $1
    AND activity.customer_id IS NOT NULL
    AND activity.event_type = ANY($2::varchar[])  -- visited, redeemed_reward, signed_up, prepaid_for_offer
    AND activity.occurred_at >= $3
    AND activity.occurred_at <= $4
) engaged
LEFT JOIN LATERAL (
  SELECT activity.customer_id
  FROM activity_event activity
  WHERE activity.business_id = $1
    AND activity.customer_id = engaged.customer_id
    AND activity.event_type = ANY($2::varchar[])
    AND activity.occurred_at < $3
  LIMIT 1
) prior ON true;
```

#### Paying guests

```sql
SELECT COUNT(*)::int AS "payingGuests"
FROM (
  SELECT payment.customer_id
  FROM funnel_payment payment
  WHERE payment.business_id = $1
    AND payment.status = 'paid'
    AND payment.customer_id IS NOT NULL
    AND COALESCE(payment.paid_at, payment.created_at) >= $2
    AND COALESCE(payment.paid_at, payment.created_at) <= $3
  UNION
  SELECT activity.customer_id
  FROM activity_event activity
  WHERE activity.business_id = $1
    AND activity.customer_id IS NOT NULL
    AND activity.event_type = 'prepaid_for_offer'
    AND activity.occurred_at >= $2
    AND activity.occurred_at <= $3
    AND COALESCE(NULLIF(activity.metadata->>'extraItemsCents', '')::int, 0) > 0
) paying;
```

#### Members series (conceptual)

Members are customers whose id appears in a `UNION` of:

- `activity_event.customer_id` for the business
- `conversation.customer_id` for the business
- `customer_visits.customer_id` for the business
- paid `funnel_payment.customer_id`
- customers matched by email to paid payments that have no `customer_id`

Then grouped by `bucket(customer.created_at)`, with a left join to distinct `signed_up` activity customers to split funnel vs restaurant members.

---

### 2) `GET /api/activity/business/:businessId/summary/monthly?months=12`

Handler: `getBusinessSummaryMonthly` → `computeBusinessSummaryMonthly`.

Same activity / payment / member aggregates, but grouped by **UTC calendar month** for the last N months. Also loads a snapshot:

| Field | Query |
| --- | --- |
| `activeCampaigns` / `todayRevenueCents` | Same KPI snapshot as above |
| `totalOrders` | `COUNT(*)` from `funnel_payment` where `business_id` and `status = paid` (all time) |
| `totalMembers` | `COUNT(DISTINCT customer.id)` from the business-customers union |

No new/returning/paying guest fields on this path.

---

### 3) `GET /api/activity/business/:businessId/summary`

Handler: `getBusinessSummary`.

One aggregate on `activity_event` only (optional event-type filter). Counts visited, redeemed, prepaid, in-person prepaid, signed up, and messages. No `funnel_payment` join.

---

### 4) `GET /api/funnel-event/business/:businessId/performance/top-campaigns`

Handler: `getBusinessTopEarningCampaigns` → `computeBusinessTopEarningCampaigns`.

**Access:** JWT + Admin/Super Admin + accessible business.

**DB operations (in parallel when a date range is present):**

| Step | Tables | What it returns |
| --- | --- | --- |
| Campaign × customer payment pairs | `funnel_payment` inner join `campaigns` | Per campaign/customer payment counts and net earnings |
| Previous window totals | `funnel_payment` + `campaigns` | Prior period earnings, orders, unique customers |
| Views by campaign | `funnel_analytics_event` → `funnels` → `campaigns` | Distinct view count |
| Signups by campaign | `funnel_event` → `funnels` → `campaigns` | Signup count |
| Daily by campaign | `funnel_payment` + `campaigns` | Day/hour earnings series |
| Daily totals | `funnel_payment` + `campaigns` | Day/hour business totals |

Earnings filter (applied to payment queries):

```sql
FROM funnel_payment p
INNER JOIN campaigns c
  ON c.id = p.campaign_id
 AND c.business_id = :businessId
 AND c.deleted_at IS NULL
WHERE p.business_id = :businessId
  AND p.status IN ('paid', 'partially_refunded')
  AND p.campaign_id IS NOT NULL
  AND NOT EXISTS (/* counterExtrasOnly activity linked to this payment */)
  AND NOT EXISTS (/* in-store visit addon-only match on same order_id */)
  AND COALESCE(p.paid_at, p.created_at) >= :from
  AND COALESCE(p.paid_at, p.created_at) <= :to
```

Net earnings expression:

```sql
GREATEST(0, COALESCE(p.amount, 0) - COALESCE(p.refunded_amount, 0))
```

The pair query groups by `campaign_id` **and** `customer_id`. Application code then rolls those pairs into campaign totals, unique customers, and repeat customers (a customer with 2+ payments on that campaign).

Views:

```sql
SELECT f.campaign_id AS "campaignId",
       COUNT(DISTINCT COALESCE(NULLIF(ae.visitor_id, ''), NULLIF(ae.session_id, ''), CONCAT('e:', ae.id::text))) AS "viewCount"
FROM funnel_analytics_event ae
INNER JOIN funnels f ON f.id = ae.funnel_id
INNER JOIN campaigns c
  ON c.id = f.campaign_id
 AND c.business_id = :businessId
 AND c.deleted_at IS NULL
WHERE ae.event_type = 'page_view'
  AND ae.deleted_at IS NULL
  AND ae.created_at >= :from
  AND ae.created_at <= :to
GROUP BY f.campaign_id;
```

Signups:

```sql
SELECT f.campaign_id AS "campaignId", COUNT(*) AS "signupCount"
FROM funnel_event e
INNER JOIN funnels f ON f.id = e.funnel_id
INNER JOIN campaigns c
  ON c.id = f.campaign_id
 AND c.business_id = :businessId
 AND c.deleted_at IS NULL
WHERE e.event_type = 'signup'
  AND e.deleted_at IS NULL
  AND e.created_at >= :from
  AND e.created_at <= :to
GROUP BY f.campaign_id;
```

---

### 5) Meta / Google spend

These are separate controllers. They are shown on the business overview in month mode. They do not use the activity/payment aggregate SQL above. Treat them as external ad-account reads with their own caching.

---

## Indexes that can help

| Index | Columns | Helps |
| --- | --- | --- |
| `IDX_activity_event_restaurant_occurred` | `business_id`, `occurred_at` | Activity range aggregates |
| `IDX_activity_event_business_type_occurred` | `business_id`, `event_type`, `occurred_at` | Filters by event type |
| `IDX_activity_event_business_customer_occurred` | `business_id`, `customer_id`, `occurred_at` (partial) | New/returning lateral lookup |
| `IDX_activity_event_business_type_customer` | `business_id`, `event_type`, `customer_id` (partial) | Signup guest membership join |
| `IDX_activity_event_idempotency` | `idempotency_key` unique | Write path for logging activity (not dashboard reads) |
| `IDX_funnel_payment_funnel_status_customer` | `funnel_id`, `status`, `customer_id` | Funnel-scoped payment lookups; business dashboard filters by `business_id` so a business+status+date index would fit better if missing |
| Campaign / analytics / visit indexes used on top campaigns | campaign business filters, analytics funnel+created, visits | Views, signups, and exclusion checks |

JSON metadata filters (`metadata->>'amountCents'`, `counterExtrasOnly`, visit source) generally cannot use a plain btree alone.

---

## How this differs from the campaign dashboard

| Topic | Business dashboard | Campaign dashboard |
| --- | --- | --- |
| Scope | One `businessId` | One `funnelId` |
| Primary feed | `activity_event` + business payments | `funnel_event` + funnel payments |
| Guest uniqueness | Activity touches + payment/visit unions | Distinct `funnel_event.customer_id` |
| Revenue | Gross paid payment amounts on overview; **net** of refunds on top campaigns | Online origin revenue sum on campaign KPIs |
| Caching | Redis + BullMQ wait for activity summary; 60s memory for KPI snapshot and top campaigns | In-memory 5m + Redis inline compute for funnel KPIs/charts |
| Auth | Business access verify; top campaigns admin-only | JWT on funnel routes |

---

## Performance plan and what changed

Root causes found in code review (no staging `EXPLAIN` timings were recorded in this pass):

1. Cold activity summary waited on BullMQ (`waitUntilFinished`) before returning.
2. Top campaigns pulled every campaign×customer payment pair into Node.js, then regrouped.
3. Business payment filters used `COALESCE(paid_at, created_at)` without a matching business-level expression index.
4. Meta/Google spend could contend with the first KPI paint.

Changes implemented now:

- Activity monthly/range summaries use inline compute with process + Redis single-flight. Stale Redis values still refresh in the background. Cache keys bumped to `activity-monthly-v6` and `activity-range-v16`.
- Top campaigns aggregate earnings, orders, unique guests, and repeats in SQL. Customer id lists load only for the limited top campaigns (for new/returning classification). Cache key bumped to `perf-top-campaigns-v8`. Metric definitions and exclusion rules are unchanged.
- Migration `1786579200129-AddBusinessDashboardPerfIndexes` adds business payment expression indexes for paid overview revenue and top-campaign earnings. Run baseline migrations before these help production.
- Overview Meta/Google spend waits until the period summary has returned, so ad APIs do not block KPI cards. Period summary and 12-month peak still start together.

Deferred (needs measured justification and larger rollout):

- `business_customer` membership mapping table
- First-engagement side table for new/returning guests
- Hourly/daily pre-aggregated analytics for business and campaign dashboards
- Testcontainers / Playwright suites (not present in this repo today)

No p50/p95/p99 numbers are claimed here. Measure those on staging with `EXPLAIN (ANALYZE, BUFFERS)` and HTTP timings after the migration is applied.

## What this report does not claim

No `EXPLAIN (ANALYZE, BUFFERS)` was run for this file, so there are no measured times and no statement that a query is currently a sequential scan in production. To confirm a plan, run `EXPLAIN` on the slow statement for one real business id and date range.
