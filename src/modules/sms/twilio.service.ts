import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import Twilio from 'twilio';
import { resolveTwilioCountryCode } from './utils/resolve-twilio-country-code';
import { normalizeTwilioSearchAreaCode } from './utils/normalize-twilio-search-area-code';

export type TwilioAccountCredentials = {
  accountSid: string;
  authToken: string;
};

export type TwilioSendOptions = {
  accountSid?: string | null;
  authToken?: string | null;
  fromPhoneNumber?: string | null;
};

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

  assertInboundSmsConfigured(): void {
    requireInboundWebhookUrl();
  }

  async assertCredentialsWork(
    credentials: TwilioAccountCredentials,
  ): Promise<void> {
    const accountSid = credentials.accountSid.trim();
    const authToken = credentials.authToken.trim();
    if (!accountSid || !authToken) {
      throw new BadRequestException(
        'Twilio Account SID and Auth Token are required.',
      );
    }

    try {
      const client = Twilio(accountSid, authToken);
      await client.api.accounts(accountSid).fetch();
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Twilio rejected these credentials.';
      this.logger.warn(`Twilio credential check failed → ${detail}`);
      throw new BadRequestException(
        'Could not connect to Twilio with those credentials. Check Account SID and Auth Token.',
      );
    }
  }

  async listIncomingPhoneNumbers(credentials?: {
    accountSid?: string | null;
    authToken?: string | null;
  }): Promise<
    Array<{ sid: string; phoneNumber: string; friendlyName: string | null }>
  > {
    const accountSid =
      credentials?.accountSid?.trim() || resolveAccountSid() || null;
    const authToken =
      credentials?.authToken?.trim() || envTrim('TWILIO_AUTH_TOKEN') || null;

    if (!accountSid || !authToken) {
      throw new ServiceUnavailableException(
        'Twilio is not configured. Add Twilio credentials for this business or set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.',
      );
    }

    try {
      const client = Twilio(accountSid, authToken);
      const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
      return numbers
        .map((n) => ({
          sid: n.sid,
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName?.trim() || null,
        }))
        .filter((n) => Boolean(n.sid && n.phoneNumber));
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Twilio API request failed.';
      this.logger.warn(`Twilio list phone numbers failed → ${detail}`);
      throw new BadRequestException(
        `Could not load Twilio phone numbers: ${detail}`,
      );
    }
  }

  async searchAvailablePhoneNumbers(params: {
    accountSid: string;
    authToken: string;
    countryCode?: string;
    areaCode?: string | null;
    areaName?: string | null;
    contains?: string | null;
    voice?: boolean;
    sms?: boolean;
    mms?: boolean;
    fax?: boolean;
    limit?: number;
  }): Promise<
    Array<{
      phoneNumber: string;
      friendlyName: string | null;
      locality: string | null;
      region: string | null;
      isoCountry: string | null;
      numberType: 'Local' | 'Mobile';
      addressRequirement: string;
      monthlyFee: string | null;
      capabilities: {
        sms: boolean;
        mms: boolean;
        voice: boolean;
        fax: boolean;
      };
    }>
  > {
    const accountSid = params.accountSid.trim();
    const authToken = params.authToken.trim();
    const countryCode = resolveTwilioCountryCode(params.countryCode);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

    if (!accountSid || !authToken) {
      throw new BadRequestException(
        'Twilio Account SID and Auth Token are required.',
      );
    }

    const areaCodeRaw = params.areaCode?.trim() || '';
    const normalizedAreaCode = normalizeTwilioSearchAreaCode(
      countryCode,
      areaCodeRaw,
    );
    const areaCode = normalizedAreaCode
      ? Number.parseInt(normalizedAreaCode, 10)
      : undefined;

    const areaName = params.areaName?.trim() || undefined;
    const contains = params.contains?.trim() || undefined;
    const capabilityFilters = {
      ...(params.voice ? { voiceEnabled: true as const } : {}),
      ...(params.sms ? { smsEnabled: true as const } : {}),
      ...(params.mms ? { mmsEnabled: true as const } : {}),
      ...(params.fax ? { faxEnabled: true as const } : {}),
    };
    const client = Twilio(accountSid, authToken);

    const feeByType: { local: string | null; mobile: string | null } = {
      local: null,
      mobile: null,
    };
    try {
      const pricing = await client.pricing.v1.phoneNumbers
        .countries(countryCode)
        .fetch();
      for (const row of pricing.phoneNumberPrices ?? []) {
        const type = String(
          (row as { number_type?: string; numberType?: string }).number_type ||
            (row as { numberType?: string }).numberType ||
            '',
        ).toLowerCase();
        const price = String(
          (row as { current_price?: string; currentPrice?: string })
            .current_price ||
            (row as { currentPrice?: string }).currentPrice ||
            (row as { base_price?: string; basePrice?: string }).base_price ||
            (row as { basePrice?: string }).basePrice ||
            '',
        ).trim();
        if (!price) continue;
        const formatted = price.startsWith('$') ? price : `$${price}`;
        if (type === 'local') feeByType.local = formatted;
        if (type === 'mobile') feeByType.mobile = formatted;
      }
    } catch (pricingError) {
      const detail =
        pricingError instanceof Error
          ? pricingError.message
          : String(pricingError);
      this.logger.warn(
        `Twilio number pricing skipped for ${countryCode} → ${detail}`,
      );
    }

    const formatAddressRequirement = (raw: string | null | undefined) => {
      const value = (raw || 'none').trim().toLowerCase();
      if (value === 'none' || !value) return 'None';
      if (value === 'any') return 'Any';
      if (value === 'local') return 'Local';
      if (value === 'foreign') return 'Foreign';
      return value.charAt(0).toUpperCase() + value.slice(1);
    };

    const mapNumber = (
      n: {
        phoneNumber?: string;
        friendlyName?: string | null;
        locality?: string | null;
        region?: string | null;
        isoCountry?: string | null;
        addressRequirements?: string | null;
        capabilities?: {
          sms?: boolean;
          SMS?: boolean;
          mms?: boolean;
          MMS?: boolean;
          voice?: boolean;
          Voice?: boolean;
          fax?: boolean;
          Fax?: boolean;
        };
      },
      numberType: 'Local' | 'Mobile',
    ) => {
      const caps = n.capabilities || {};
      return {
        phoneNumber: n.phoneNumber || '',
        friendlyName: n.friendlyName?.trim() || null,
        locality: n.locality?.trim() || null,
        region: n.region?.trim() || null,
        isoCountry: n.isoCountry?.trim() || countryCode,
        numberType,
        addressRequirement: formatAddressRequirement(n.addressRequirements),
        monthlyFee:
          numberType === 'Local' ? feeByType.local : feeByType.mobile,
        capabilities: {
          sms: Boolean(caps.sms ?? caps.SMS),
          mms: Boolean(caps.mms ?? caps.MMS),
          voice: Boolean(caps.voice ?? caps.Voice),
          fax: Boolean(caps.fax ?? caps.Fax),
        },
      };
    };

    const localFilters = {
      ...(areaCode ? { areaCode } : {}),
      ...(areaName ? { inLocality: areaName } : {}),
      ...(contains ? { contains } : {}),
      ...capabilityFilters,
      limit,
    };

    const mobileFilters = {
      ...(contains ? { contains } : {}),
      ...capabilityFilters,
      limit,
    };

    try {
      let rows: Array<ReturnType<typeof mapNumber>> = [];
      try {
        const locals = await client
          .availablePhoneNumbers(countryCode)
          .local.list(localFilters);
        rows = locals
          .map((n) => mapNumber(n, 'Local'))
          .filter((n) => Boolean(n.phoneNumber));
      } catch (localError) {
        const detail =
          localError instanceof Error ? localError.message : String(localError);
        this.logger.warn(
          `Twilio local number search skipped for ${countryCode} → ${detail}`,
        );
      }

      if (rows.length < limit) {
        try {
          const mobiles = await client
            .availablePhoneNumbers(countryCode)
            .mobile.list({
              ...mobileFilters,
              limit: Math.max(1, limit - rows.length),
            });
          const seen = new Set(rows.map((n) => n.phoneNumber));
          for (const row of mobiles.map((n) => mapNumber(n, 'Mobile'))) {
            if (!row.phoneNumber || seen.has(row.phoneNumber)) continue;
            rows.push(row);
            seen.add(row.phoneNumber);
            if (rows.length >= limit) break;
          }
        } catch (mobileError) {
          const detail =
            mobileError instanceof Error
              ? mobileError.message
              : String(mobileError);
          this.logger.warn(
            `Twilio mobile number search skipped for ${countryCode} → ${detail}`,
          );
        }
      }

      return rows;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : 'Twilio API request failed.';
      this.logger.warn(`Twilio available number search failed → ${detail}`);
      const lower = detail.toLowerCase();
      if (
        lower.includes('not found') ||
        lower.includes('invalid') ||
        lower.includes('20404') ||
        lower.includes('country')
      ) {
        throw new BadRequestException(
          `Twilio has no SMS numbers for ${countryCode} on this account. Try another country (for example US or CA).`,
        );
      }
      throw new BadRequestException(
        `Could not search available Twilio numbers: ${detail}`,
      );
    }
  }

  async purchasePhoneNumber(params: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  }): Promise<{ sid: string; phoneNumber: string; friendlyName: string | null }> {
    const accountSid = params.accountSid.trim();
    const authToken = params.authToken.trim();
    const phoneNumber =
      normalizePhoneNumber(params.phoneNumber.trim()) ??
      params.phoneNumber.trim();

    if (!accountSid || !authToken || !phoneNumber) {
      throw new BadRequestException(
        'Twilio credentials and a phone number are required to purchase.',
      );
    }

    const webhookUrl = requireInboundWebhookUrl();

    try {
      const client = Twilio(accountSid, authToken);
      const created = await client.incomingPhoneNumbers.create({
        phoneNumber,
        smsUrl: webhookUrl,
        smsMethod: 'POST',
      });

      return {
        sid: created.sid,
        phoneNumber: created.phoneNumber,
        friendlyName: created.friendlyName?.trim() || null,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : 'Twilio rejected this purchase.';
      this.logger.warn(`Twilio purchase failed → ${phoneNumber}: ${detail}`);
      throw new BadRequestException(
        `Could not buy that Twilio number: ${detail}`,
      );
    }
  }

  async sendSms(
    to: string,
    body: string,
    options?: TwilioSendOptions,
  ): Promise<{ sid: string }> {
    const accountSid = options?.accountSid?.trim() || resolveAccountSid() || null;
    const authToken =
      options?.authToken?.trim() || envTrim('TWILIO_AUTH_TOKEN') || null;
    const fromPhoneNumber =
      normalizeTwilioPhoneNumber(options?.fromPhoneNumber ?? undefined) ||
      this.fromPhoneNumber;

    const usingBusinessCredentials = Boolean(
      options?.accountSid?.trim() && options?.authToken?.trim(),
    );

    if (!accountSid || !authToken || !fromPhoneNumber) {
      throw new ServiceUnavailableException(
        usingBusinessCredentials
          ? 'This business Twilio account is missing a phone number. Select a number in Integrations.'
          : 'Twilio SMS is not configured on the server.',
      );
    }

    const client =
      usingBusinessCredentials || !this.client
        ? Twilio(accountSid, authToken)
        : this.client;

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
      const message = await client.messages.create({
        body: trimmedBody,
        from: fromPhoneNumber,
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

  async syncInboundWebhookForNumber(params: {
    accountSid: string;
    authToken: string;
    phoneSid: string;
    phoneNumber: string;
  }): Promise<void> {
    const webhookUrl = requireInboundWebhookUrl();

    try {
      const client = Twilio(params.accountSid.trim(), params.authToken.trim());
      await client.incomingPhoneNumbers(params.phoneSid.trim()).update({
        smsUrl: webhookUrl,
        smsMethod: 'POST',
      });
      this.logger.log(
        `Twilio inbound webhook synced for ${params.phoneNumber} → ${webhookUrl}`,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : 'Unknown Twilio API error';
      this.logger.warn(
        `Twilio inbound webhook sync failed for ${params.phoneNumber} → ${detail}`,
      );
      throw new BadRequestException(
        `Number saved, but inbound SMS webhook could not be set: ${detail}. Replies may not appear in Guest Chats until this is fixed.`,
      );
    }
  }

  async clearInboundWebhookForNumber(params: {
    accountSid: string;
    authToken: string;
    phoneSid: string;
    phoneNumber: string;
  }): Promise<boolean> {
    const phoneSid = params.phoneSid.trim();
    if (!phoneSid) {
      return false;
    }

    try {
      const client = Twilio(params.accountSid.trim(), params.authToken.trim());
      await client.incomingPhoneNumbers(phoneSid).update({
        smsUrl: '',
        smsMethod: 'POST',
      });
      this.logger.log(
        `Twilio inbound webhook cleared for ${params.phoneNumber} (number kept on Twilio account).`,
      );
      return true;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Unknown Twilio API error';
      this.logger.warn(
        `Twilio inbound webhook clear failed for ${params.phoneNumber} → ${detail}`,
      );
      return false;
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

function requireInboundWebhookUrl(): string {
  const webhookUrl = envTrim('TWILIO_WEBHOOK_PUBLIC_URL');
  if (!webhookUrl) {
    throw new BadRequestException(
      'Inbound SMS is not configured on the server (TWILIO_WEBHOOK_PUBLIC_URL). Connect cannot finish until this is set so replies can reach Dealioo.',
    );
  }
  return webhookUrl;
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

export function maskTwilioAccountSid(accountSid: string | null | undefined): string | null {
  const sid = accountSid?.trim() || '';
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}
