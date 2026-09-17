import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Twilio from 'twilio';
import { Repository } from 'typeorm';
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
import { decryptSecret } from '../../utils/token-encryption.util';
import {
  normalizePhoneNumber,
  phoneDigitsOnly,
} from './twilio.service';

function envTrim(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

@Injectable()
export class TwilioWebhookValidatorService {
  constructor(
    @InjectRepository(BusinessTwilioIntegration)
    private readonly twilioIntegrationRepository: Repository<BusinessTwilioIntegration>,
  ) {}

  async validateSignature(
    signature: string | undefined,
    webhookUrls: string[],
    params: Record<string, string>,
  ): Promise<{ valid: boolean; matchedUrl?: string }> {
    if (!signature?.trim()) {
      return { valid: false };
    }

    const tokens = await this.resolveAuthTokensForInbound(params.To);
    if (tokens.length === 0) {
      return { valid: false };
    }

    for (const authToken of tokens) {
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
    }

    return { valid: false };
  }

  private async resolveAuthTokensForInbound(
    toRaw: string | undefined,
  ): Promise<string[]> {
    const tokens: string[] = [];
    const seen = new Set<string>();

    const push = (token: string | null | undefined) => {
      const trimmed = token?.trim() || '';
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      tokens.push(trimmed);
    };

    const normalizedTo = normalizePhoneNumber(toRaw?.trim() || '');
    if (normalizedTo) {
      const digits = phoneDigitsOnly(normalizedTo);
      const integrations = await this.twilioIntegrationRepository
        .createQueryBuilder('integration')
        .where('integration.twilio_auth_token IS NOT NULL')
        .andWhere('integration.twilio_phone_number IS NOT NULL')
        .andWhere(
          `regexp_replace(integration.twilio_phone_number, '[^0-9]', '', 'g') = :digits`,
          { digits },
        )
        .getMany();

      for (const integration of integrations) {
        try {
          push(decryptSecret(integration.twilioAuthToken!.trim()));
        } catch {
        }
      }
    }

    push(envTrim('TWILIO_AUTH_TOKEN'));
    return tokens;
  }
}
