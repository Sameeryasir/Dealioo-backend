import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import Twilio from 'twilio';

const MAX_ALPHANUMERIC_SENDER_LENGTH = 11;

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio.Twilio | null = null;
  private fromPhoneNumber: string | null = null;
  private smsSenderName: string | null = null;

  async onModuleInit(): Promise<void> {
    const accountSid = resolveAccountSid();
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    this.fromPhoneNumber = normalizeTwilioPhoneNumber(
      envTrim('TWILIO_PHONE_NUMBER'),
    );
    this.smsSenderName = resolveSmsSenderName();

    if (!accountSid || !authToken || !this.fromPhoneNumber) {
      this.logger.warn(
        'Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID (or ACCOUNT_SID), TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.',
      );
      return;
    }

    this.client = Twilio(accountSid, authToken);
    this.logger.log(
      `Twilio SMS ready (from: ${this.fromPhoneNumber}, brand: ${this.smsSenderName ?? 'none'})`,
    );

    await this.syncInboundWebhookUrl();
  }

  isConfigured(): boolean {
    return this.client != null && this.fromPhoneNumber != null;
  }

  async sendSms(
    to: string,
    body: string,
    options?: { replyable?: boolean },
  ): Promise<{ sid: string }> {
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

    const { from, brandInBody } = options?.replyable
      ? {
          from: this.fromPhoneNumber!,
          brandInBody: Boolean(this.smsSenderName),
        }
      : this.resolveSmsFrom(toNumber);
    const messageBody = brandInBody
      ? prefixSmsWithBrand(trimmedBody, this.smsSenderName)
      : trimmedBody;

    try {
      const message = await this.client.messages.create({
        body: messageBody,
        from,
        to: toNumber,
      });

      return { sid: message.sid };
    } catch (error) {
      if (from !== this.fromPhoneNumber && this.fromPhoneNumber) {
        try {
          const fallbackBody = prefixSmsWithBrand(
            trimmedBody,
            this.smsSenderName,
          );
          const message = await this.client.messages.create({
            body: fallbackBody,
            from: this.fromPhoneNumber,
            to: toNumber,
          });
          this.logger.warn(
            `Twilio alphanumeric sender "${from}" failed for ${toNumber}; sent with phone number instead.`,
          );
          return { sid: message.sid };
        } catch (fallbackError) {
          error = fallbackError;
        }
      }

      const detail =
        error instanceof Error ? error.message : 'Twilio rejected this SMS.';
      this.logger.warn(`Twilio send failed → ${toNumber}: ${detail}`);
      throw new BadRequestException(`Could not send SMS: ${detail}`);
    }
  }

  private resolveSmsFrom(toNumber: string): {
    from: string;
    brandInBody: boolean;
  } {
    const senderName = this.smsSenderName;
    const requiresPhoneSender = isUsOrCanadaNumber(toNumber);

    if (senderName && !requiresPhoneSender) {
      return { from: senderName, brandInBody: false };
    }

    return {
      from: this.fromPhoneNumber!,
      brandInBody: Boolean(senderName),
    };
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

function resolveSmsSenderName(): string | null {
  const raw = envTrim('TWILIO_SMS_SENDER_NAME');
  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, MAX_ALPHANUMERIC_SENDER_LENGTH);
}

function normalizeTwilioPhoneNumber(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const compact = raw.replace(/\s/g, '');
  return normalizePhoneNumber(compact) ?? compact;
}

function isUsOrCanadaNumber(toNumber: string): boolean {
  return /^\+1\d{10}$/.test(toNumber);
}

function prefixSmsWithBrand(body: string, brand: string | null): string {
  if (!brand) {
    return body;
  }

  const prefix = `${brand}:`;
  if (body.toLowerCase().startsWith(prefix.toLowerCase())) {
    return body;
  }

  return `${prefix} ${body}`;
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
