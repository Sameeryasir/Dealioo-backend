import { config } from 'dotenv';
import twilio from 'twilio';

config();

const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
const toPhone =
  process.env.TWILIO_PHONE_NUMBER?.trim() || '+16206999892';
const publicWebhookUrl =
  process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim() ||
  'https://1060-39-58-226-160.ngrok-free.app/api/sms/twilio/inbound';
const localPort = process.env.PORT?.trim() || '4001';
const postUrl =
  process.env.SIMULATE_INBOUND_POST_URL?.trim() ||
  `http://127.0.0.1:${localPort}/api/sms/twilio/inbound`;

const fromPhone = (process.argv[2] || '+16206999892').trim();
const body = (process.argv[3] || 'Hello — simulated inbound SMS').trim();

async function main(): Promise<void> {
  if (!authToken) {
    throw new Error('TWILIO_AUTH_TOKEN is missing in .env');
  }
  if (!fromPhone || !body) {
    throw new Error('From phone and body are required');
  }

  const messageSid = `SM${Date.now()}${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`;

  const params: Record<string, string> = {
    From: fromPhone,
    To: toPhone,
    Body: body,
    MessageSid: messageSid,
    SmsSid: messageSid,
    SmsStatus: 'received',
    AccountSid:
      process.env.TWILIO_ACCOUNT_SID?.trim() ||
      process.env.ACCOUNT_SID?.trim() ||
      '',
  };

  const signature = twilio.getExpectedTwilioSignature(
    authToken,
    publicWebhookUrl,
    params,
  );

  const formBody = new URLSearchParams(params).toString();

  console.log(
    JSON.stringify(
      {
        postUrl,
        signedAs: publicWebhookUrl,
        from: fromPhone,
        to: toPhone,
        body,
        messageSid,
      },
      null,
      2,
    ),
  );

  const response = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': signature,
    },
    body: formBody,
  });

  const responseText = await response.text();
  console.log(`status=${response.status}`);
  console.log(responseText || '(empty body)');

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
