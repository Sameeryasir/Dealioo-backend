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

  onModuleInit(): void {
    const accountSid = resolveAccountSid();
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    this.fromPhoneNumber = envTrim('TWILIO_PHONE_NUMBER') ?? null;

    if (!accountSid || !authToken || !this.fromPhoneNumber) {
      this.logger.warn(
        'Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID (or ACCOUNT_SID), TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.',
      );
      return;
    }

    this.client = Twilio(accountSid, authToken);
    this.logger.log(`Twilio SMS ready (from: ${this.fromPhoneNumber})`);
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

  validateInboundWebhook(
    signature: string | undefined,
    webhookUrl: string,
    params: Record<string, string>,
  ): boolean {
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    if (!authToken || !signature?.trim()) {
      return false;
    }

    return Twilio.validateRequest(
      authToken,
      signature.trim(),
      webhookUrl.trim(),
      params,
    );
  }
}

function envTrim(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function resolveAccountSid(): string | undefined {
  return envTrim('TWILIO_ACCOUNT_SID') ?? envTrim('ACCOUNT_SID');
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
