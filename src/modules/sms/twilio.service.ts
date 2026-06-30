import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio.Twilio | null = null;
  private fromNumber: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const accountSid = this.resolveAccountSid();
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim();
    const fromNumber = this.config.get<string>('TWILIO_PHONE_NUMBER')?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.warn(
        'Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID (or ACCOUNT_SID), TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env.',
      );
      return;
    }

    this.client = Twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
    this.logger.log(`Twilio SMS ready (from: ${fromNumber})`);
  }

  isConfigured(): boolean {
    return this.client != null && this.fromNumber != null;
  }

  async sendSms(to: string, body: string): Promise<{ sid: string }> {
    if (!this.client || !this.fromNumber) {
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
        from: this.fromNumber,
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

  private resolveAccountSid(): string | undefined {
    return (
      this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim() ||
      this.config.get<string>('ACCOUNT_SID')?.trim() ||
      undefined
    );
  }
}

function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
}
