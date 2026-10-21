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

  isPlatformAccountConfigured(): boolean {
    return Boolean(resolveAccountSid() && envTrim('TWILIO_AUTH_TOKEN'));
  }

  requirePlatformCredentials(): TwilioAccountCredentials {
    const accountSid = resolveAccountSid();
    const authToken = envTrim('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      throw new ServiceUnavailableException(
        'Dealioo Twilio is not configured on the server.',
      );
    }
    return { accountSid, authToken };
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
        error instanceof Error
          ? error.message
          : 'Twilio rejected these credentials.';
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
        'Twilio is not configured on the server.',
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
        monthlyFee: numberType === 'Local' ? feeByType.local : feeByType.mobile,
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
  }): Promise<{
    sid: string;
    phoneNumber: string;
    friendlyName: string | null;
  }> {
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
        error instanceof Error
          ? error.message
          : 'Twilio rejected this purchase.';
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
    const accountSid =
      options?.accountSid?.trim() || resolveAccountSid() || null;
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
    smsUrl?: string | null;
  }): Promise<{ smsUrl: string }> {
    // Reject private/localhost targets so Super Admin cannot point SMS at an internal host.
    const webhookUrl = assertSafePublicHttpsWebhookUrl(
      params.smsUrl?.trim() || requireInboundWebhookUrl(),
    );

    try {
      const client = Twilio(params.accountSid.trim(), params.authToken.trim());
      await client.incomingPhoneNumbers(params.phoneSid.trim()).update({
        smsUrl: webhookUrl,
        smsMethod: 'POST',
      });
      this.logger.log(
        `Twilio inbound webhook synced for ${params.phoneNumber} → ${webhookUrl}`,
      );
      return { smsUrl: webhookUrl };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : 'Unknown Twilio API error';
      this.logger.warn(
        `Twilio inbound webhook sync failed for ${params.phoneNumber} → ${detail}`,
      );
      // Do not leak Twilio/API internals to the client.
      throw new BadRequestException(
        'Inbound SMS webhook could not be set. Check the URL and try again.',
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

  /**
   * Super Admin Twilio basic overview (server-side).
   * Returns account owner name, balance, and owned numbers.
   * SIDs stay internal for assignment matching — not meant for the public API shape.
   * Related: platform-admin.service getTwilioDashboard
   */
  async getPlatformCreditsAndNumbers(): Promise<{
    configured: boolean;
    accountOwnerName: string | null;
    balance: {
      amount: number | null;
      currency: string | null;
    } | null;
    defaultWebhookUrl: string | null;
    phoneNumbers: Array<{
      sid: string;
      phoneNumber: string;
      friendlyName: string | null;
      status: string | null;
      addressRequirement: string | null;
      dateCreated: string | null;
      webhookUrl: string | null;
      webhookConfigured: boolean;
      capabilities: {
        sms: boolean;
        mms: boolean;
        voice: boolean;
        fax: boolean;
      };
    }>;
    error: string | null;
  }> {
    const accountSid = resolveAccountSid() || null;
    const authToken = envTrim('TWILIO_AUTH_TOKEN') || null;
    const configured = Boolean(accountSid && authToken);
    const defaultWebhookUrl = envTrim('TWILIO_WEBHOOK_PUBLIC_URL') || null;

    const base = {
      configured,
      accountOwnerName: null as string | null,
      defaultWebhookUrl,
      balance: null as {
        amount: number | null;
        currency: string | null;
      } | null,
      phoneNumbers: [] as Array<{
        sid: string;
        phoneNumber: string;
        friendlyName: string | null;
        status: string | null;
        addressRequirement: string | null;
        dateCreated: string | null;
        webhookUrl: string | null;
        webhookConfigured: boolean;
        capabilities: {
          sms: boolean;
          mms: boolean;
          voice: boolean;
          fax: boolean;
        };
      }>,
      error: null as string | null,
    };

    if (!accountSid || !authToken) {
      // Keep this message non-technical — no env key names on the client.
      base.error = 'Twilio is not connected on this server yet.';
      return base;
    }

    try {
      const client = this.client ?? Twilio(accountSid, authToken);
      const [account, balance, numbers] = await Promise.all([
        client.api
          .accounts(accountSid)
          .fetch()
          .catch(() => null),
        client.balance.fetch().catch(() => null),
        client.incomingPhoneNumbers.list({ limit: 200 }),
      ]);

      base.accountOwnerName =
        account?.friendlyName?.trim() ||
        envTrim('TWILIO_SMS_SENDER_NAME') ||
        null;

      if (balance) {
        const amount = Number(balance.balance);
        base.balance = {
          amount: Number.isFinite(amount) ? amount : null,
          currency: balance.currency?.trim() || null,
        };
      }

      // sid kept only for server-side business matching; stripped before API response.
      base.phoneNumbers = numbers
        .map((n) => {
          const caps = n.capabilities as
            | {
                sms?: boolean;
                mms?: boolean;
                voice?: boolean;
                fax?: boolean;
              }
            | undefined;
          // Some Twilio SDK builds omit `status` on IncomingPhoneNumber — read safely.
          const statusRaw = (n as { status?: string | null }).status;
          const webhookUrl = n.smsUrl?.trim() || null;
          return {
            sid: n.sid,
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName?.trim() || null,
            status: statusRaw?.trim() || null,
            addressRequirement: n.addressRequirements?.trim() || null,
            dateCreated: n.dateCreated
              ? new Date(n.dateCreated).toISOString()
              : null,
            webhookUrl,
            webhookConfigured: Boolean(webhookUrl),
            capabilities: {
              sms: Boolean(caps?.sms),
              mms: Boolean(caps?.mms),
              voice: Boolean(caps?.voice),
              fax: Boolean(caps?.fax),
            },
          };
        })
        .filter((n) => Boolean(n.sid && n.phoneNumber));

      return base;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Twilio API request failed.';
      this.logger.warn(`Twilio credits/numbers view failed → ${detail}`);
      // Do not forward raw Twilio/API details to the dashboard client.
      base.error = 'Could not load Twilio account overview right now.';
      return base;
    }
  }

  async getPlatformAccountView(): Promise<{
    configured: boolean;
    smsReady: boolean;
    accountSidMasked: string | null;
    defaultFromNumber: string | null;
    senderName: string | null;
    webhookUrl: string | null;
    account: {
      friendlyName: string | null;
      status: string | null;
      type: string | null;
    } | null;
    balance: {
      amount: number | null;
      currency: string | null;
    } | null;
    usage: {
      smsThisMonth: number | null;
      smsSpendThisMonth: number | null;
      totalSpendThisMonth: number | null;
      currency: string | null;
      dailySms: Array<{ date: string; count: number }>;
    };
    recentMessages: Array<{
      sid: string;
      from: string | null;
      to: string | null;
      body: string | null;
      status: string | null;
      direction: string | null;
      dateSent: string | null;
      price: string | null;
      priceUnit: string | null;
      errorCode: string | null;
    }>;
    phoneNumbers: Array<{
      sid: string;
      phoneNumber: string;
      friendlyName: string | null;
      smsUrl: string | null;
      capabilities: {
        sms: boolean;
        mms: boolean;
        voice: boolean;
      };
    }>;
    error: string | null;
  }> {
    const accountSid = resolveAccountSid() || null;
    const authToken = envTrim('TWILIO_AUTH_TOKEN') || null;
    const defaultFromNumber =
      this.fromPhoneNumber ||
      normalizeTwilioPhoneNumber(envTrim('TWILIO_PHONE_NUMBER'));
    const senderName = envTrim('TWILIO_SMS_SENDER_NAME') || null;
    const webhookUrl = envTrim('TWILIO_WEBHOOK_PUBLIC_URL') || null;
    const configured = Boolean(accountSid && authToken);

    const emptyUsage = {
      smsThisMonth: null as number | null,
      smsSpendThisMonth: null as number | null,
      totalSpendThisMonth: null as number | null,
      currency: null as string | null,
      dailySms: [] as Array<{ date: string; count: number }>,
    };

    const base = {
      configured,
      smsReady: this.isConfigured(),
      accountSidMasked: maskTwilioAccountSid(accountSid),
      defaultFromNumber,
      senderName,
      webhookUrl,
      account: null as {
        friendlyName: string | null;
        status: string | null;
        type: string | null;
      } | null,
      balance: null as {
        amount: number | null;
        currency: string | null;
      } | null,
      usage: emptyUsage,
      recentMessages: [] as Array<{
        sid: string;
        from: string | null;
        to: string | null;
        body: string | null;
        status: string | null;
        direction: string | null;
        dateSent: string | null;
        price: string | null;
        priceUnit: string | null;
        errorCode: string | null;
      }>,
      phoneNumbers: [] as Array<{
        sid: string;
        phoneNumber: string;
        friendlyName: string | null;
        smsUrl: string | null;
        capabilities: {
          sms: boolean;
          mms: boolean;
          voice: boolean;
        };
      }>,
      error: null as string | null,
    };

    if (!accountSid || !authToken) {
      base.error = 'Twilio is not connected on this server yet.';
      return base;
    }

    try {
      const client = this.client ?? Twilio(accountSid, authToken);
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const dayStart = new Date(now);
      dayStart.setUTCDate(dayStart.getUTCDate() - 6);
      dayStart.setUTCHours(0, 0, 0, 0);

      const [
        account,
        balance,
        numbers,
        smsMonth,
        totalMonth,
        smsDaily,
        messages,
      ] = await Promise.all([
        client.api.accounts(accountSid).fetch(),
        client.balance.fetch().catch(() => null),
        client.incomingPhoneNumbers.list({ limit: 200 }),
        client.usage.records
          .list({
            category: 'sms',
            startDate: monthStart,
            endDate: now,
            limit: 1,
          })
          .catch(() => []),
        client.usage.records
          .list({
            category: 'totalprice',
            startDate: monthStart,
            endDate: now,
            limit: 1,
          })
          .catch(() => []),
        client.usage.records.daily
          .list({
            category: 'sms',
            startDate: dayStart,
            endDate: now,
            limit: 14,
          })
          .catch(() => []),
        client.messages.list({ limit: 40 }).catch(() => []),
      ]);

      base.account = {
        friendlyName: account.friendlyName?.trim() || null,
        status: account.status?.trim() || null,
        type: account.type?.trim() || null,
      };

      if (balance) {
        const amount = Number(balance.balance);
        base.balance = {
          amount: Number.isFinite(amount) ? amount : null,
          currency: balance.currency?.trim() || null,
        };
      }

      const smsMonthRow = smsMonth[0];
      const totalMonthRow = totalMonth[0];
      const smsCount = Number(smsMonthRow?.count ?? smsMonthRow?.usage);
      const smsPrice = Number(smsMonthRow?.price);
      const totalPrice = Number(totalMonthRow?.price);

      base.usage = {
        smsThisMonth: Number.isFinite(smsCount) ? smsCount : null,
        smsSpendThisMonth: Number.isFinite(smsPrice) ? smsPrice : null,
        totalSpendThisMonth: Number.isFinite(totalPrice) ? totalPrice : null,
        currency:
          smsMonthRow?.priceUnit?.trim() ||
          totalMonthRow?.priceUnit?.trim() ||
          balance?.currency?.trim() ||
          null,
        dailySms: [...smsDaily]
          .map((row) => {
            const dateValue = row.startDate
              ? new Date(row.startDate).toISOString().slice(0, 10)
              : '';
            const count = Number(row.count ?? row.usage);
            return {
              date: dateValue,
              count: Number.isFinite(count) ? count : 0,
            };
          })
          .filter((row) => Boolean(row.date))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };

      // `.catch(() => [])` widens Twilio MessageInstance[] — normalize safely.
      base.recentMessages = (
        messages as Array<{
          sid?: string;
          from?: string | null;
          to?: string | null;
          body?: string | null;
          status?: string | null;
          direction?: string | null;
          dateSent?: string | Date | null;
          dateCreated?: string | Date | null;
          price?: string | null;
          priceUnit?: string | null;
          errorCode?: string | number | null;
        }>
      ).map((message) => ({
        sid: String(message.sid ?? ''),
        from: message.from?.trim() || null,
        to: message.to?.trim() || null,
        body: message.body?.trim() || null,
        status: message.status?.trim() || null,
        direction: message.direction?.trim() || null,
        dateSent: message.dateSent
          ? new Date(message.dateSent).toISOString()
          : message.dateCreated
            ? new Date(message.dateCreated).toISOString()
            : null,
        price: message.price?.trim() || null,
        priceUnit: message.priceUnit?.trim() || null,
        errorCode: message.errorCode == null ? null : String(message.errorCode),
      }));

      base.phoneNumbers = numbers
        .map((n) => ({
          sid: n.sid,
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName?.trim() || null,
          smsUrl: n.smsUrl?.trim() || null,
          capabilities: {
            sms: Boolean(n.capabilities?.sms),
            mms: Boolean(n.capabilities?.mms),
            voice: Boolean(n.capabilities?.voice),
          },
        }))
        .filter((n) => Boolean(n.sid && n.phoneNumber));

      return base;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Twilio API request failed.';
      this.logger.warn(`Twilio platform account view failed → ${detail}`);
      base.error = detail;
      return base;
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

      if (
        phoneRecord.smsUrl === webhookUrl &&
        phoneRecord.smsMethod === 'POST'
      ) {
        this.logger.log(
          `Twilio inbound webhook already configured → ${webhookUrl}`,
        );
        return;
      }

      await this.client.incomingPhoneNumbers(phoneRecord.sid).update({
        smsUrl: webhookUrl,
        smsMethod: 'POST',
      });
      this.logger.log(
        `Twilio inbound webhook synced on phone number → ${webhookUrl}`,
      );
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
      'Inbound SMS is not configured on the server yet. Connect cannot finish until the webhook URL is set so replies can reach Dealioo.',
    );
  }
  return assertSafePublicHttpsWebhookUrl(webhookUrl);
}

/**
 * Ensure webhook targets are public HTTPS only (blocks localhost / private IPs).
 * Used before writing smsUrl onto a Twilio phone number.
 */
function assertSafePublicHttpsWebhookUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new BadRequestException('Webhook URL is required.');
  }
  if (value.length > 500) {
    throw new BadRequestException('Webhook URL is too long.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('Webhook URL is not valid.');
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use https.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException(
      'Webhook URL must not include username or password.',
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new BadRequestException(
      'Webhook URL cannot point to a local or internal host.',
    );
  }

  // Block common private / link-local IPv4 ranges (SSRF hygiene).
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map((part) => Number(part));
    const [a, b] = parts;
    const isPrivate =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (isPrivate || parts.some((n) => n > 255)) {
      throw new BadRequestException(
        'Webhook URL cannot point to a private network address.',
      );
    }
  }

  return parsed.toString();
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

export function maskTwilioAccountSid(
  accountSid: string | null | undefined,
): string | null {
  const sid = accountSid?.trim() || '';
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}
