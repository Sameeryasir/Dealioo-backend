/**
 * One-off seed: fake funnel events for a business (signups + payments).
 * Usage: npx ts-node -r tsconfig-paths/register scripts/seed-business-funnel-events.ts [businessId]
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { FunnelEventType } from '../src/db/entities/funnel-event.entity';
import { FunnelPaymentStatus } from '../src/db/entities/funnel-payment.entity';

config();

const BUSINESS_ID = Number(process.argv[2] ?? 14);

type FunnelRow = { funnel_id: number; campaign_id: number; campaign_name: string };

type CustomerRow = { id: number; name: string; email: string };

const FAKE_EVENTS: Array<{
  eventType: FunnelEventType;
  customerIndex: number;
  amount: number | null;
  paymentStatus: FunnelPaymentStatus | null;
  daysAgo: number;
  funnelIndex: number;
}> = [
  { eventType: FunnelEventType.SIGNUP, customerIndex: 0, amount: null, paymentStatus: null, daysAgo: 0, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 0, amount: 2499, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 0, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 1, amount: null, paymentStatus: null, daysAgo: 1, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 1, amount: 1899, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 1, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 2, amount: null, paymentStatus: null, daysAgo: 2, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 2, amount: 3200, paymentStatus: FunnelPaymentStatus.PENDING, daysAgo: 2, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 3, amount: null, paymentStatus: null, daysAgo: 3, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 3, amount: 1500, paymentStatus: FunnelPaymentStatus.FAILED, daysAgo: 3, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 4, amount: null, paymentStatus: null, daysAgo: 5, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 4, amount: 4500, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 5, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 5, amount: null, paymentStatus: null, daysAgo: 7, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 5, amount: 2799, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 7, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 6, amount: null, paymentStatus: null, daysAgo: 10, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 6, amount: 1999, paymentStatus: FunnelPaymentStatus.REFUNDED, daysAgo: 10, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 7, amount: null, paymentStatus: null, daysAgo: 14, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 7, amount: 3500, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 14, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 0, amount: null, paymentStatus: null, daysAgo: 4, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 1, amount: 2200, paymentStatus: FunnelPaymentStatus.PAID, daysAgo: 6, funnelIndex: 0 },
  { eventType: FunnelEventType.SIGNUP, customerIndex: 2, amount: null, paymentStatus: null, daysAgo: 8, funnelIndex: 0 },
  { eventType: FunnelEventType.PAYMENT, customerIndex: 3, amount: 990, paymentStatus: FunnelPaymentStatus.PENDING, daysAgo: 9, funnelIndex: 0 },
];

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(10 + (days % 8), 15 + (days % 30), 0, 0);
  return d;
}

async function main() {
  if (!Number.isFinite(BUSINESS_ID) || BUSINESS_ID < 1) {
    throw new Error('Valid business id is required.');
  }

  await AppDataSource.initialize();
  const qr = AppDataSource.createQueryRunner();

  try {
    const business = await qr.manager.query(
      `SELECT id, name FROM businesses WHERE id = $1`,
      [BUSINESS_ID],
    );
    if (!business.length) {
      throw new Error(`Business ${BUSINESS_ID} not found.`);
    }

    let funnels = (await qr.manager.query(
      `
        SELECT f.id AS funnel_id, f.campaign_id, c.campaign_name
        FROM funnels f
        INNER JOIN campaigns c ON c.id = f.campaign_id
        WHERE c.restaurant_id = $1
        ORDER BY f.id ASC
      `,
      [BUSINESS_ID],
    )) as FunnelRow[];

    if (!funnels.length) {
      const campaigns = await qr.manager.query(
        `SELECT id, campaign_name FROM campaigns WHERE restaurant_id = $1 ORDER BY id ASC LIMIT 1`,
        [BUSINESS_ID],
      );
      if (!campaigns.length) {
        throw new Error(`Business ${BUSINESS_ID} has no campaigns. Create a campaign first.`);
      }

      const campaignId = campaigns[0].id as number;
      const inserted = await qr.manager.query(
        `
          INSERT INTO funnels (campaign_id, pages, version, published, created_at, updated_at)
          VALUES ($1, '{}'::jsonb, 1, true, NOW(), NOW())
          RETURNING id AS funnel_id
        `,
        [campaignId],
      );
      funnels = [
        {
          funnel_id: inserted[0].funnel_id,
          campaign_id: campaignId,
          campaign_name: campaigns[0].campaign_name,
        },
      ];
      console.log(`Created funnel ${funnels[0].funnel_id} for campaign ${campaignId}.`);
    }

    let customers = (await qr.manager.query(
      `SELECT id, name, email FROM customers WHERE email LIKE '%.mock@dealioo.io' ORDER BY id DESC LIMIT 20`,
    )) as CustomerRow[];

    if (customers.length < 8) {
      const seedCustomers = [
        ['Ayesha Khan', 'ayesha.khan.mock@dealioo.io'],
        ['Bilal Ahmed', 'bilal.ahmed.mock@dealioo.io'],
        ['Sara Malik', 'sara.malik.mock@dealioo.io'],
        ['Omar Hassan', 'omar.hassan.mock@dealioo.io'],
        ['Fatima Noor', 'fatima.noor.mock@dealioo.io'],
        ['Hassan Raza', 'hassan.raza.mock@dealioo.io'],
        ['Zainab Ali', 'zainab.ali.mock@dealioo.io'],
        ['Usman Tariq', 'usman.tariq.mock@dealioo.io'],
      ];

      for (const [name, email] of seedCustomers) {
        await qr.manager.query(
          `
            INSERT INTO customers (name, email, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
            ON CONFLICT (email) DO NOTHING
          `,
          [name, email],
        );
      }

      customers = (await qr.manager.query(
        `SELECT id, name, email FROM customers WHERE email LIKE '%.mock@dealioo.io' ORDER BY id DESC LIMIT 20`,
      )) as CustomerRow[];
    }

    customers.reverse();

    const funnelId = funnels[0].funnel_id;
    let insertedCount = 0;

    for (const event of FAKE_EVENTS) {
      const customer = customers[event.customerIndex % customers.length];
      const createdAt = daysAgoDate(event.daysAgo);
      const targetFunnel = funnels[event.funnelIndex % funnels.length] ?? funnels[0];

      await qr.manager.query(
        `
          INSERT INTO funnel_event (
            funnel_id,
            event_type,
            customer_id,
            customer_email,
            amount,
            currency,
            payment_status,
            receipt_url,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          targetFunnel.funnel_id,
          event.eventType,
          customer.id,
          customer.email,
          event.amount,
          event.amount != null ? 'usd' : null,
          event.paymentStatus,
          event.paymentStatus === FunnelPaymentStatus.PAID
            ? 'https://pay.stripe.com/receipts/mock-receipt'
            : null,
          createdAt,
        ],
      );
      insertedCount += 1;
    }

    const total = await qr.manager.query(
      `
        SELECT COUNT(*)::int AS count
        FROM funnel_event fe
        INNER JOIN funnels f ON f.id = fe.funnel_id
        INNER JOIN campaigns c ON c.id = f.campaign_id
        WHERE c.restaurant_id = $1
      `,
      [BUSINESS_ID],
    );

    console.log(
      `Seeded ${insertedCount} fake funnel events for business ${BUSINESS_ID} (${business[0].name}).`,
    );
    console.log(`Funnel used: ${funnelId}. Total events now: ${total[0].count}.`);
  } finally {
    await qr.release();
    await AppDataSource.destroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
