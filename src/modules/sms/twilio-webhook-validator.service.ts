import { Injectable } from '@nestjs/common';
import Twilio from 'twilio';

function envTrim(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

@Injectable()
export class TwilioWebhookValidatorService {
  validateSignature(
    signature: string | undefined,
    webhookUrls: string[],
    params: Record<string, string>,
  ): { valid: boolean; matchedUrl?: string } {
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    if (!authToken || !signature?.trim()) {
      return { valid: false };
    }

    for (const webhookUrl of webhookUrls) {
      const trimmedUrl = webhookUrl.trim();
      if (!trimmedUrl) {
        continue;
      }

      if (
        Twilio.validateRequest(
          authToken,
          signature.trim(),
          trimmedUrl,
          params,
        )
      ) {
        return { valid: true, matchedUrl: trimmedUrl };
      }
    }

    return { valid: false };
  }
}
