import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import Twilio from 'twilio';

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio.Twilio | null = null;
  private fromPhoneNumber: string | null = null;

  async onModuleInit(): Promise<void> {
    const accountSid = resolveAccountSid();
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    this.fromPhoneNumber = normalizeTwilioPhoneNumber(
      envTrim('TWILIO_PHONE_NUMBER'),
    );

    if (!accountSid || !authToken || !this.fromPhoneNumber) {
      this.logger.warn(
        'Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID (or ACCOUNT_SID), TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.',
      );
      return;
    }

    this.client = Twilio(accountSid, authToken);
    this.logger.log(`Twilio SMS ready (from: ${this.fromPhoneNumber})`);

    await this.syncInboundWebhookUrl();
  }

  isConfigured(): boolean {
    return this.client != null && this.fromPhoneNumber != null;
  }

  async sendSms(to: string, body: string): Promise<{ sid: string }> {
    if (!this.client || !this.fromPhoneNumber) {
      throw new ServiceUnavailableException(
        'Twilio SMS is not configured on the server.',
      );
    }

    const toNumber = normalizePhoneNumber(to);
    const trimmedBody = body.trim();

    if (!toNumber) {
      throw new BadRequestException(
        'This guest does not have a valid phone number on file.',
      );
    }

    if (!trimmedBody) {
      throw new BadRequestException('Message cannot be empty.');
    }

    try {
      const message = await this.client.messages.create({
        body: trimmedBody,
        from: this.fromPhoneNumber,
        to: toNumber,
      });

      return { sid: message.sid };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Twilio rejected this SMS.';
      this.logger.warn(`Twilio send failed → ${toNumber}: ${detail}`);
      throw new BadRequestException(`Could not send SMS: ${detail}`);
    }
  }

  private async syncInboundWebhookUrl(): Promise<void> {
    const webhookUrl = envTrim('TWILIO_WEBHOOK_PUBLIC_URL');
    if (!this.client || !this.fromPhoneNumber || !webhookUrl) {
      return;
    }

    try {
      const numbers = await this.client.incomingPhoneNumbers.list({
        phoneNumber: this.fromPhoneNumber,
        limit: 1,
      });
      const phoneRecord = numbers[0];
      if (!phoneRecord) {
        this.logger.warn(
          `Twilio inbound webhook not synced — phone ${this.fromPhoneNumber} not found in account.`,
        );
        return;
      }

      if (phoneRecord.smsUrl === webhookUrl && phoneRecord.smsMethod === 'POST') {
        this.logger.log(`Twilio inbound webhook already configured → ${webhookUrl}`);
        return;
      }

      await this.client.incomingPhoneNumbers(phoneRecord.sid).update({
        smsUrl: webhookUrl,
        smsMethod: 'POST',
      });
      this.logger.log(`Twilio inbound webhook synced on phone number → ${webhookUrl}`);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown Twilio API error';
      this.logger.warn(`Twilio inbound webhook sync failed → ${detail}`);
    }
  }
}

function envTrim(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function resolveAccountSid(): string | undefined {
  return envTrim('TWILIO_ACCOUNT_SID') ?? envTrim('ACCOUNT_SID');
}

function normalizeTwilioPhoneNumber(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const compact = raw.replace(/\s/g, '');
  return normalizePhoneNumber(compact) ?? compact;
}

export function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) {
    return trimmed;
  }

  let digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return null;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length > 10) {
    digits = digits.slice(1);
  }

  if (digits.length >= 11 && digits.length <= 15 && /^[1-9]/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}

export function phoneDigitsOnly(normalizedPhone: string): string {
  return normalizedPhone.replace(/\D/g, '');
}
