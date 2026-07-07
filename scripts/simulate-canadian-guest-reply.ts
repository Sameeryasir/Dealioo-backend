import 'reflect-metadata';
import { config } from 'dotenv';
import { createHmac, randomUUID } from 'crypto';
import { resolve } from 'path';
import { Client } from 'pg';

config({ path: resolve(__dirname, '../.env') });

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length).trim();
}

function normalizePhone(raw: string): string {
  const compact = raw.replace(/\s/g, '');
  if (compact.startsWith('+')) return compact;
  const digits = compact.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return compact;
}

function buildTwilioSignature(
  authToken: string,
  webhookUrl: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], webhookUrl);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

async function ensureConversation(
  db: Client,
  customerId: number,
  restaurantId: number,
): Promise<void> {
  const existing = await db.query(
    `SELECT id FROM conversation
     WHERE customer_id = $1 AND restaurant_id = $2 AND is_private = true
     LIMIT 1`,
    [customerId, restaurantId],
  );

  if (existing.rows[0]) {
    return;
  }

  await db.query(
    `INSERT INTO conversation (
       restaurant_id, customer_id, is_private, message_count, created_at, updated_at
     ) VALUES ($1, $2, true, 0, now(), now())`,
    [restaurantId, customerId],
  );

  console.log(
    `Created empty conversation thread for customer ${customerId} at restaurant ${restaurantId}.`,
  );
}

async function main(): Promise<void> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twilioTo = normalizePhone(process.env.TWILIO_PHONE_NUMBER?.trim() ?? '');
  const webhookUrl =
    readArg('url')?.trim() ||
    process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim() ||
    'http://localhost:4001/sms/twilio/inbound';

  const body = readArg('body') ?? 'Hello — simulated reply from Canadian guest.';
  const fromPhone = normalizePhone(readArg('from') ?? '+16475492528');
  const restaurantId = Number(readArg('restaurant-id') ?? '14');

  if (!authToken) {
    throw new Error('TWILIO_AUTH_TOKEN is missing in .env');
  }
  if (!twilioTo) {
    throw new Error('TWILIO_PHONE_NUMBER is missing in .env');
  }
  if (!Number.isFinite(restaurantId) || restaurantId < 1) {
    throw new Error('Provide a valid --restaurant-id (e.g. 14).');
  }

  const db = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5433', 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();

  const customerResult = await db.query(
    `SELECT id, name FROM customers
     WHERE REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g')
       = REGEXP_REPLACE($1, '[^0-9]', '', 'g')
     ORDER BY id DESC
     LIMIT 1`,
    [fromPhone],
  );

  const customer = customerResult.rows[0] as
    | { id: number; name: string | null }
    | undefined;

  if (!customer) {
    await db.end();
    throw new Error(
      `No customer found with phone ${fromPhone}. Update customers.phone first.`,
    );
  }

  await ensureConversation(db, customer.id, restaurantId);
  await db.end();

  const messageSid = `SMsim${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const params: Record<string, string> = {
    From: fromPhone,
    To: twilioTo,
    Body: body,
    MessageSid: messageSid,
    SmsStatus: 'received',
    AccountSid: process.env.ACCOUNT_SID?.trim() ?? process.env.TWILIO_ACCOUNT_SID?.trim() ?? '',
  };

  const signature = buildTwilioSignature(authToken, webhookUrl, params);
  const formBody = new URLSearchParams(params).toString();

  console.log('Simulating inbound SMS as Canadian guest…');
  console.log(`  Guest:    ${customer.name ?? 'Guest'} (customer ${customer.id})`);
  console.log(`  From:     ${fromPhone}`);
  console.log(`  To:       ${twilioTo}`);
  console.log(`  Body:     ${body}`);
  console.log(`  Webhook:  ${webhookUrl}`);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature,
    },
    body: formBody,
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Webhook failed (${response.status}): ${responseText.slice(0, 300)}`,
    );
  }

  console.log(`Webhook OK (${response.status}). MessageSid: ${messageSid}`);
  console.log('Check Guest Chats in the dashboard — message should appear via DB + Pusher.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
