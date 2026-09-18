import 'reflect-metadata';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import AppDataSource from '../src/data-source';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../src/modules/member/member.constants';

config();

const OWNER_EMAIL = 'sameeryasir02@gmail.com';
const SOURCE_USER_ID = '31';
const CSV_PATH = path.resolve(__dirname, '../sameeryasir02-records.csv');

type Row = Record<string, string>;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (char !== '\r') cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function groupRecords(filePath: string): Map<string, Row[]> {
  const table = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const grouped = new Map<string, Map<string, Row>>();
  for (const cells of table.slice(1)) {
    const [recordType, field, value = '', rowId = ''] = cells;
    if (!recordType || !field || recordType === 'record_type') continue;
    if (!grouped.has(recordType)) grouped.set(recordType, new Map());
    const rows = grouped.get(recordType)!;
    if (!rows.has(rowId)) rows.set(rowId, {});
    rows.get(rowId)![field] = value;
  }
  const result = new Map<string, Row[]>();
  for (const [recordType, rows] of grouped) {
    result.set(recordType, [...rows.values()]);
  }
  return result;
}

function blank(value: unknown): boolean {
  return value == null || value === '';
}

function postgresJson(value: string): string | null {
  let current = value.trim();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!current) return null;
    try {
      const parsed: unknown = JSON.parse(current);
      if (typeof parsed === 'string') {
        current = parsed.trim();
        continue;
      }
      return JSON.stringify(parsed);
    } catch {
      const doubled = current.replace(/""/g, '"');
      if (doubled !== current) {
        current = doubled;
        continue;
      }
      if (
        current.length >= 2 &&
        current.startsWith('"') &&
        current.endsWith('"')
      ) {
        current = current.slice(1, -1).trim();
        continue;
      }
      return null;
    }
  }
  return null;
}

function coerceJsonFields(fields: Row, columns: Set<string>): void {
  for (const key of Object.keys(fields)) {
    if (!columns.has(key)) continue;
    const next = postgresJson(fields[key]);
    if (next == null) delete fields[key];
    else fields[key] = next;
  }
}

async function tableColumns(table: string): Promise<Set<string>> {
  const rows = (await AppDataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )) as Array<{ column_name: string }>;
  return new Set(rows.map((row) => row.column_name));
}

async function jsonColumns(table: string): Promise<Set<string>> {
  const rows = (await AppDataSource.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('json', 'jsonb')`,
    [table],
  )) as Array<{ column_name: string }>;
  return new Set(rows.map((row) => row.column_name));
}

function pickColumns(
  row: Row,
  columns: Set<string>,
  skip: string[],
): Row {
  const picked: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (skip.includes(key) || !columns.has(key) || blank(value)) continue;
    picked[key] = value;
  }
  return picked;
}

async function fillMissing(
  table: string,
  whereSql: string,
  whereParams: unknown[],
  incoming: Row,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const existing = (await AppDataSource.query(
    `SELECT * FROM ${table} WHERE ${whereSql} LIMIT 1`,
    whereParams,
  )) as Array<Record<string, unknown>>;
  const current = existing[0];
  if (!current) {
    const keys = Object.keys(incoming);
    if (keys.length === 0) return 'unchanged';
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
    await AppDataSource.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
      keys.map((key) => incoming[key]),
    );
    return 'inserted';
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (!blank(current[key])) continue;
    params.push(value);
    sets.push(`${key} = $${params.length}`);
  }
  if (sets.length === 0) return 'unchanged';
  params.push(...whereParams);
  const where = whereSql.replace(/\$(\d+)/g, (_, number: string) => {
    return `$${params.length - whereParams.length + Number(number)}`;
  });
  await AppDataSource.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`,
    params,
  );
  return 'updated';
}

const STATS_START = new Date(Date.UTC(2026, 3, 1));

const CAMPAIGN_PLANS: Record<
  string,
  Array<{ name: string; priceCents: number; category: string }>
> = {
  'velvet-hand-care': [
    { name: 'Signature Manicure', priceCents: 2900, category: 'beauty_wellness' },
    { name: 'Glow Facial', priceCents: 4900, category: 'beauty_wellness' },
    { name: 'Hand Massage', priceCents: 1900, category: 'beauty_wellness' },
  ],
  'ember-coffee-house': [
    { name: 'Latte Club', priceCents: 650, category: 'coffee_tea' },
    { name: 'Pastry Bundle', priceCents: 899, category: 'coffee_tea' },
    { name: 'Cold Brew', priceCents: 550, category: 'coffee_tea' },
  ],
  'flame-burger-kitchen': [
    { name: 'Classic Burger', priceCents: 1299, category: 'food_and_beverage' },
    { name: 'Smash Burger', priceCents: 1699, category: 'food_and_beverage' },
    { name: 'Loaded Fries Combo', priceCents: 899, category: 'food_and_beverage' },
  ],
};

type StatsResult = {
  campaigns: number;
  seededCampaigns: number;
  payments: number;
  signups: number;
  views: number;
  clicks: number;
  customers: number;
  activity: number;
};

function utcDaysThroughToday(from: Date): Date[] {
  const end = new Date();
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const days: Date[] = [];
  for (let cursor = from.getTime(); cursor <= last; cursor += 86400000) {
    days.push(new Date(cursor));
  }
  return days;
}

function stampOnDay(day: Date, hour: number): Date | null {
  const stamped = new Date(day.getTime() + hour * 3600000 + 15 * 60000);
  if (stamped.getTime() <= Date.now()) return stamped;
  const fallback = new Date(Date.now() - 1000);
  if (fallback.getTime() < day.getTime()) return null;
  return fallback;
}

async function insertBatch(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictSql = '',
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const chunkSize = Math.max(1, Math.floor(3000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((row) => {
        const placeholders = row.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      })
      .join(', ');
    const saved = (await AppDataSource.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesSql}${conflictSql} RETURNING 1`,
      params,
    )) as unknown[];
    inserted += saved.length;
  }
  return inserted;
}

async function ensureCampaign(
  businessId: number,
  userId: number,
  slug: string,
  plan: { name: string; priceCents: number; category: string },
): Promise<{ campaignId: number; funnelId: number; hasPaid: boolean }> {
  const found = (await AppDataSource.query(
    `SELECT c.id AS campaign_id, f.id AS funnel_id
     FROM campaigns c
     LEFT JOIN funnels f ON f.campaign_id = c.id AND f.deleted_at IS NULL
     WHERE c.business_id = $1 AND c.campaign_name = $2 AND c.deleted_at IS NULL
     LIMIT 1`,
    [businessId, plan.name],
  )) as Array<{ campaign_id: number; funnel_id: number | null }>;

  let campaignId = found[0]?.campaign_id;
  let funnelId = found[0]?.funnel_id ?? null;
  if (!campaignId) {
    const inserted = (await AppDataSource.query(
      `INSERT INTO campaigns (
         business_id, created_by, campaign_name, website_url, offer, price,
         status, campaign_type, campaign_category, description
       ) VALUES ($1, $2, $3, $4, $5, $6, 'published', 'prepaid', $7, $8)
       RETURNING id`,
      [
        businessId,
        userId,
        plan.name,
        `https://${slug}.example.com`,
        plan.name,
        (plan.priceCents / 100).toFixed(2),
        plan.category,
        plan.name,
      ],
    )) as Array<{ id: number }>;
    campaignId = inserted[0].id;
  }

  if (!funnelId) {
    const inserted = (await AppDataSource.query(
      `INSERT INTO funnels (campaign_id, business_id, published, content_revision)
       VALUES ($1, $2, true, 0)
       RETURNING id`,
      [campaignId, businessId],
    )) as Array<{ id: number }>;
    funnelId = inserted[0].id;
  }

  const paid = (await AppDataSource.query(
    `SELECT 1 FROM funnel_payment WHERE campaign_id = $1 AND status = 'paid' LIMIT 1`,
    [campaignId],
  )) as unknown[];
  return { campaignId, funnelId, hasPaid: paid.length > 0 };
}

async function ensureStatCustomers(
  businessId: number,
  days: Date[],
): Promise<Array<{ id: number; email: string }>> {
  const prefix = `seed.sameer.${businessId}.`;
  const existing = (await AppDataSource.query(
    `SELECT id, email FROM customers WHERE email LIKE $1 ORDER BY id`,
    [`${prefix}%`],
  )) as Array<{ id: number; email: string }>;
  if (existing.length >= 60) return existing;

  const names = [
    'Ayesha Khan',
    'Bilal Ahmed',
    'Sara Malik',
    'Omar Hassan',
    'Fatima Noor',
    'Hassan Raza',
  ];
  const rows: unknown[][] = [];
  for (let index = existing.length; index < 90; index += 1) {
    const day = days[index % days.length];
    const createdAt = stampOnDay(day, 9) ?? day;
    rows.push([
      names[index % names.length],
      `${prefix}${index}@example.com`,
      createdAt,
      createdAt,
    ]);
  }
  await insertBatch(
    'customers',
    ['name', 'email', 'created_at', 'updated_at'],
    rows,
    ' ON CONFLICT (email) DO NOTHING',
  );
  return (await AppDataSource.query(
    `SELECT id, email FROM customers WHERE email LIKE $1 ORDER BY id`,
    [`${prefix}%`],
  )) as Array<{ id: number; email: string }>;
}

async function seedBusinessAndCampaignStats(
  userId: number,
  businesses: Array<{ id: number; slug: string }>,
): Promise<StatsResult> {
  const totals: StatsResult = {
    campaigns: 0,
    seededCampaigns: 0,
    payments: 0,
    signups: 0,
    views: 0,
    clicks: 0,
    customers: 0,
    activity: 0,
  };
  const days = utcDaysThroughToday(STATS_START);
  if (days.length === 0) return totals;

  for (const business of businesses) {
    const plans = CAMPAIGN_PLANS[business.slug];
    if (!plans) continue;

    const activityCount = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM activity_event WHERE business_id = $1`,
      [business.id],
    )) as Array<{ count: number }>;
    const needsActivity = Number(activityCount[0]?.count ?? 0) === 0;
    let customers: Array<{ id: number; email: string }> = [];

    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      const ready = await ensureCampaign(
        business.id,
        userId,
        business.slug,
        plans[planIndex],
      );
      totals.campaigns += 1;
      const signupRows = (await AppDataSource.query(
        `SELECT 1 FROM funnel_event WHERE funnel_id = $1 LIMIT 1`,
        [ready.funnelId],
      )) as unknown[];
      const viewRows = (await AppDataSource.query(
        `SELECT 1 FROM funnel_analytics_event WHERE funnel_id = $1 LIMIT 1`,
        [ready.funnelId],
      )) as unknown[];
      const needsPayments = !ready.hasPaid;
      const needsSignups = signupRows.length === 0;
      const needsViews = viewRows.length === 0;
      if (!needsPayments && !needsSignups && !needsViews) continue;
      if (customers.length === 0) {
        customers = await ensureStatCustomers(business.id, days);
        totals.customers += customers.length;
      }
      if (customers.length === 0) continue;

      const payments: unknown[][] = [];
      const signups: unknown[][] = [];
      const analytics: unknown[][] = [];
      const paymentsPerDay = planIndex === 0 ? 2 : 1;
      const viewsPerDay = 4 - planIndex;
      const clicksPerDay = planIndex === 0 ? 2 : 1;
      const signupsPerDay = 3 - planIndex;

      days.forEach((day, dayIndex) => {
        if (needsPayments) {
          for (let copy = 0; copy < paymentsPerDay; copy += 1) {
            const at = stampOnDay(day, 11 + copy);
            if (!at) continue;
            const customer = customers[(dayIndex + copy + planIndex) % customers.length];
            payments.push([
              ready.funnelId,
              business.id,
              ready.campaignId,
              customer.id,
              plans[planIndex].priceCents,
              'usd',
              'paid',
              customer.email,
              `seed-sameer-${business.id}-${ready.campaignId}-${dayIndex}-${copy}`,
              at,
              at,
              at,
            ]);
          }
        }
        if (needsSignups) {
          for (let copy = 0; copy < signupsPerDay; copy += 1) {
            const at = stampOnDay(day, 10 + copy);
            if (!at) continue;
            const customer = customers[(dayIndex + copy) % customers.length];
            signups.push([
              ready.funnelId,
              'signup',
              customer.id,
              customer.email,
              at,
              at,
            ]);
          }
        }
        if (!needsViews) return;
        for (let copy = 0; copy < viewsPerDay; copy += 1) {
          const at = stampOnDay(day, 8 + copy);
          if (!at) continue;
          const customer = customers[(dayIndex + copy) % customers.length];
          analytics.push([
            ready.funnelId,
            customer.id,
            `seed-sameer-${business.id}-${customer.id}`,
            'page_view',
            at,
          ]);
        }
        for (let copy = 0; copy < clicksPerDay; copy += 1) {
          const at = stampOnDay(day, 13 + copy);
          if (!at) continue;
          const customer = customers[(dayIndex + 2 + copy) % customers.length];
          analytics.push([
            ready.funnelId,
            customer.id,
            `seed-sameer-${business.id}-${customer.id}`,
            'button_click',
            at,
          ]);
        }
      });

      totals.payments += await insertBatch(
        'funnel_payment',
        [
          'funnel_id',
          'business_id',
          'campaign_id',
          'customer_id',
          'amount',
          'currency',
          'status',
          'customer_email',
          'stripe_payment_intent_id',
          'paid_at',
          'created_at',
          'updated_at',
        ],
        payments,
        ' ON CONFLICT (stripe_payment_intent_id) DO NOTHING',
      );
      totals.signups += await insertBatch(
        'funnel_event',
        [
          'funnel_id',
          'event_type',
          'customer_id',
          'customer_email',
          'created_at',
          'updated_at',
        ],
        signups,
      );
      await insertBatch(
        'funnel_analytics_event',
        ['funnel_id', 'customer_id', 'visitor_id', 'event_type', 'created_at'],
        analytics,
      );
      totals.views += analytics.filter((row) => row[3] === 'page_view').length;
      totals.clicks += analytics.filter((row) => row[3] === 'button_click').length;
      totals.seededCampaigns += 1;
    }

    if (needsActivity && customers.length === 0) {
      customers = await ensureStatCustomers(business.id, days);
      totals.customers += customers.length;
    }
    if (!needsActivity || customers.length === 0) continue;

    const activityRows = days.flatMap((day, dayIndex) => {
      const at = stampOnDay(day, 12);
      if (!at) return [];
      const customer = customers[dayIndex % customers.length];
      return [[
        business.id,
        customer.id,
        'visited',
        'Visited the business',
        at,
        `seed-sameer-activity:${business.id}:${day.toISOString().slice(0, 10)}`,
      ]];
    });
    totals.activity += await insertBatch(
      'activity_event',
      [
        'business_id',
        'customer_id',
        'event_type',
        'description',
        'occurred_at',
        'idempotency_key',
      ],
      activityRows,
      ' ON CONFLICT (idempotency_key) DO NOTHING',
    );
  }

  return totals;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`);
  }
  const records = groupRecords(CSV_PATH);
  const userRow = records.get('users')?.[0];
  if (!userRow || userRow.email?.toLowerCase() !== OWNER_EMAIL) {
    throw new Error(`CSV is missing ${OWNER_EMAIL}`);
  }

  await AppDataSource.initialize();
  const userColumns = await tableColumns('users');
  const businessColumns = await tableColumns('businesses');
  const memberColumns = await tableColumns('business_members');
  const subscriptionColumns = await tableColumns('user_subscriptions');
  const onboardingColumns = await tableColumns('onboarding_events');
  const historyColumns = await tableColumns('business_history');
  const userJson = await jsonColumns('users');
  const businessJson = await jsonColumns('businesses');
  const memberJson = await jsonColumns('business_members');
  const subscriptionJson = await jsonColumns('user_subscriptions');
  const onboardingJson = await jsonColumns('onboarding_events');
  const historyJson = await jsonColumns('business_history');

  const existingUsers = (await AppDataSource.query(
    `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [OWNER_EMAIL],
  )) as Array<{ id: number }>;

  let userId = existingUsers[0]?.id ?? null;
  let userAction: 'created' | 'updated' | 'unchanged' = 'unchanged';
  const userFields = pickColumns(userRow, userColumns, [
    'id',
    'created_by',
    'role_id',
    'password_hash',
    'two_factor_secret',
  ]);
  coerceJsonFields(userFields, userJson);

  if (!userId) {
    const roleRows = (await AppDataSource.query(
      `SELECT id FROM roles WHERE id = $1
       UNION ALL
       SELECT id FROM roles ORDER BY id LIMIT 1`,
      [Number(userRow.role_id) || 0],
    )) as Array<{ id: number }>;
    const roleId = roleRows[0]?.id;
    if (!roleId) throw new Error('No role exists to attach the new user.');
    const googleTaken = userFields.google_id
      ? ((await AppDataSource.query(
          `SELECT id FROM users WHERE google_id = $1 LIMIT 1`,
          [userFields.google_id],
        )) as Array<{ id: number }>)
      : [];
    if (googleTaken.length > 0) delete userFields.google_id;
    const keys = [...Object.keys(userFields), 'role_id'];
    const values = [...Object.values(userFields), roleId];
    const inserted = (await AppDataSource.query(
      `INSERT INTO users (${keys.join(', ')}) VALUES (${keys
        .map((_, index) => `$${index + 1}`)
        .join(', ')}) RETURNING id`,
      values,
    )) as Array<{ id: number }>;
    userId = inserted[0].id;
    userAction = 'created';
  } else {
    const filled = await fillMissing('users', 'id = $1', [userId], userFields);
    userAction = filled === 'inserted' ? 'updated' : filled;
  }

  const businessIdMap = new Map<string, number>();
  let businessesInserted = 0;
  let businessesUpdated = 0;
  for (const business of records.get('businesses') ?? []) {
    const sourceId = business.id;
    const fields = pickColumns(business, businessColumns, ['id', 'owner_id']);
    fields.owner_id = String(userId);
    coerceJsonFields(fields, businessJson);
    const found = (await AppDataSource.query(
      `SELECT id FROM businesses WHERE owner_id = $1 AND (slug = $2 OR name = $3) LIMIT 1`,
      [userId, business.slug, business.name],
    )) as Array<{ id: number }>;
    if (!found[0]) {
      const keys = Object.keys(fields);
      const inserted = (await AppDataSource.query(
        `INSERT INTO businesses (${keys.join(', ')}) VALUES (${keys
          .map((_, index) => `$${index + 1}`)
          .join(', ')}) RETURNING id`,
        Object.values(fields),
      )) as Array<{ id: number }>;
      businessIdMap.set(sourceId, inserted[0].id);
      businessesInserted += 1;
      continue;
    }
    businessIdMap.set(sourceId, found[0].id);
    const filled = await fillMissing(
      'businesses',
      'id = $1',
      [found[0].id],
      fields,
    );
    if (filled === 'updated') businessesUpdated += 1;
  }

  let membersInserted = 0;
  for (const member of records.get('business_members') ?? []) {
    const businessId = businessIdMap.get(member.business_id);
    if (!businessId) continue;
    const fields = pickColumns(member, memberColumns, [
      'id',
      'business_id',
      'user_id',
      'invited_by',
      'role_id',
      'permissions',
    ]);
    fields.business_id = String(businessId);
    fields.user_id = String(userId);
    if (memberColumns.has('permissions')) {
      fields.permissions =
        postgresJson(member.permissions ?? '') ??
        JSON.stringify(ALL_BUSINESS_MEMBER_PERMISSIONS);
    }
    coerceJsonFields(fields, memberJson);
    const existing = (await AppDataSource.query(
      `SELECT id FROM business_members WHERE business_id = $1 AND user_id = $2 LIMIT 1`,
      [businessId, userId],
    )) as Array<{ id: number }>;
    if (existing[0]) continue;
    const keys = Object.keys(fields);
    await AppDataSource.query(
      `INSERT INTO business_members (${keys.join(', ')}) VALUES (${keys
        .map((_, index) => `$${index + 1}`)
        .join(', ')})`,
      keys.map((key) =>
        key === 'permissions' ? fields.permissions : fields[key],
      ),
    );
    membersInserted += 1;
  }

  let subscriptionInserted = 0;
  const subscription = records.get('user_subscriptions')?.[0];
  if (subscription) {
    const already = (await AppDataSource.query(
      `SELECT id FROM user_subscriptions WHERE user_id = $1 OR stripe_subscription_id = $2 LIMIT 1`,
      [userId, subscription.stripe_subscription_id || null],
    )) as Array<{ id: string }>;
    const plan = (await AppDataSource.query(
      `SELECT id FROM subscription_plans WHERE id = $1 LIMIT 1`,
      [subscription.plan_id],
    )) as Array<{ id: string }>;
    if (!already[0] && plan[0]) {
      const fields = pickColumns(subscription, subscriptionColumns, [
        'id',
        'user_id',
      ]);
      fields.user_id = String(userId);
      fields.plan_id = plan[0].id;
      coerceJsonFields(fields, subscriptionJson);
      const keys = Object.keys(fields);
      await AppDataSource.query(
        `INSERT INTO user_subscriptions (${keys.join(', ')}) VALUES (${keys
          .map((_, index) => `$${index + 1}`)
          .join(', ')})`,
        Object.values(fields),
      );
      subscriptionInserted = 1;
    }
  }

  let onboardingInserted = 0;
  for (const event of records.get('onboarding_events') ?? []) {
    const key = event.idempotency_key?.replace(
      new RegExp(`:${SOURCE_USER_ID}$`),
      `:${userId}`,
    );
    if (!key) continue;
    const existing = (await AppDataSource.query(
      `SELECT id FROM onboarding_events WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    )) as Array<{ id: number }>;
    if (existing[0]) continue;
    const fields = pickColumns(event, onboardingColumns, ['id', 'user_id']);
    fields.user_id = String(userId);
    fields.idempotency_key = key;
    coerceJsonFields(fields, onboardingJson);
    const keys = Object.keys(fields);
    await AppDataSource.query(
      `INSERT INTO onboarding_events (${keys.join(', ')}) VALUES (${keys
        .map((_, index) => `$${index + 1}`)
        .join(', ')})`,
      Object.values(fields),
    );
    onboardingInserted += 1;
  }

  let historyInserted = 0;
  for (const event of records.get('business_history') ?? []) {
    if (!event.idempotency_key) continue;
    const existing = (await AppDataSource.query(
      `SELECT id FROM business_history WHERE idempotency_key = $1 LIMIT 1`,
      [event.idempotency_key],
    )) as Array<{ id: number }>;
    if (existing[0]) continue;
    const fields = pickColumns(event, historyColumns, [
      'id',
      'business_id',
      'actor_user_id',
    ]);
    fields.actor_user_id = String(userId);
    const mappedBusiness = businessIdMap.get(event.business_id);
    if (mappedBusiness && historyColumns.has('business_id')) {
      fields.business_id = String(mappedBusiness);
    }
    coerceJsonFields(fields, historyJson);
    const keys = Object.keys(fields);
    await AppDataSource.query(
      `INSERT INTO business_history (${keys.join(', ')}) VALUES (${keys
        .map((_, index) => `$${index + 1}`)
        .join(', ')})`,
      Object.values(fields),
    );
    historyInserted += 1;
  }

  if (!userId) throw new Error(`User ${OWNER_EMAIL} was not created.`);
  const ownedBusinesses = (records.get('businesses') ?? [])
    .map((business) => ({
      id: businessIdMap.get(business.id) ?? 0,
      slug: business.slug,
    }))
    .filter((business) => business.id > 0 && business.slug);
  const stats = await seedBusinessAndCampaignStats(userId, ownedBusinesses);

  console.log(`User ${OWNER_EMAIL} (#${userId}) ${userAction}`);
  console.log(
    `Businesses inserted ${businessesInserted}, empty fields filled ${businessesUpdated}`,
  );
  console.log(`Memberships inserted ${membersInserted}`);
  console.log(`Subscription inserted ${subscriptionInserted}`);
  console.log(`Onboarding events inserted ${onboardingInserted}`);
  console.log(`History rows inserted ${historyInserted}`);
  console.log(
    `Campaigns ready ${stats.campaigns}, campaigns given new stats ${stats.seededCampaigns}`,
  );
  console.log(
    `Payments ${stats.payments}, signups ${stats.signups}, page views ${stats.views}, button clicks ${stats.clicks}`,
  );
  console.log(`Customers ${stats.customers}, visits ${stats.activity}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });
