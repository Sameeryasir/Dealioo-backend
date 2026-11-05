/**
 * One-off / local helper: send an SMS from business 3's Twilio number.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/send-business-3-sms.ts
 *   npx ts-node -r tsconfig-paths/register scripts/send-business-3-sms.ts --to=03329927360 --body="Hello"
 *
 * Defaults:
 *   businessId = 3
 *   to = 03329927360  →  +923329927360
 */
import { config } from 'dotenv';
import { Client } from 'pg';
import Twilio from 'twilio';

config();

const BUSINESS_ID = 3;
const DEFAULT_TO = '03329927360';
const DEFAULT_BODY =
  'Hello from Flame Burger Kitchen (Dealio test). Reply to this message to continue the chat.';

function envTrim(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function resolveAccountSid(): string | undefined {
  return envTrim('TWILIO_ACCOUNT_SID') ?? envTrim('ACCOUNT_SID');
}

/** Normalize PK local 03… / 923… / +92… into E.164. */
function normalizePakistanMobile(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Destination phone number is required.');
  }
  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) {
    return trimmed;
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length === 11) {
    // e.g. 03329927360 → 923329927360
    digits = `92${digits.slice(1)}`;
  }
  if (digits.startsWith('92') && digits.length === 12) {
    return `+${digits}`;
  }
  throw new Error(
    `Could not normalize phone "${raw}" to a Pakistan E.164 number.`,
  );
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function loadBusinessTwilioFromNumber(
  businessId: number,
): Promise<string> {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  try {
    const result = await client.query<{
      twilio_phone_number: string | null;
      name: string | null;
    }>(
      `
        SELECT b.name, t.twilio_phone_number
        FROM businesses b
        LEFT JOIN business_twilio_integrations t ON t.business_id = b.id
        WHERE b.id = $1
      `,
      [businessId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Business ${businessId} was not found.`);
    }
    const from = row.twilio_phone_number?.trim();
    if (!from) {
      throw new Error(
        `Business ${businessId} (${row.name ?? 'unknown'}) has no Twilio number connected.`,
      );
    }
    console.log(`Business ${businessId}: ${row.name ?? 'unknown'}`);
    console.log(`From Twilio number: ${from}`);
    return from;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const accountSid = resolveAccountSid();
  const authToken = envTrim('TWILIO_AUTH_TOKEN');
  if (!accountSid || !authToken) {
    throw new Error(
      'Missing Twilio credentials. Set ACCOUNT_SID (or TWILIO_ACCOUNT_SID) and TWILIO_AUTH_TOKEN in .env.',
    );
  }

  const toRaw = readArg('to') ?? DEFAULT_TO;
  const body = (readArg('body') ?? DEFAULT_BODY).trim();
  if (!body) {
    throw new Error('Message body cannot be empty.');
  }

  const to = normalizePakistanMobile(toRaw);
  const from = await loadBusinessTwilioFromNumber(BUSINESS_ID);

  console.log(`To: ${to}`);
  console.log(`Body: ${body}`);

  const twilio = Twilio(accountSid, authToken);
  const message = await twilio.messages.create({
    from,
    to,
    body,
  });

  console.log(`Sent. Twilio SID: ${message.sid}`);
  console.log(`Status: ${message.status}`);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`FAILED: ${detail}`);
  process.exit(1);
});
