import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { GoogleFunnelEvent } from '../../db/entities/google-funnel-event.entity';
import {
  createGoogleAdsApiClient,
  createGoogleAdsCustomer,
  formatGoogleAdsSdkError,
  normalizeGoogleCustomerId,
} from '../google-ads/google-ads-sdk.client';
import { GoogleAdsTokenService } from '../google-ads/google-ads-token.service';

type ConversionActionRow = {
  conversionAction?: {
    resourceName?: string;
    resource_name?: string;
    id?: string | number;
    name?: string;
    tagSnippets?: Array<{ eventSnippet?: string; event_snippet?: string }>;
    tag_snippets?: Array<{ eventSnippet?: string; event_snippet?: string }>;
  };
  conversion_action?: {
    resourceName?: string;
    resource_name?: string;
    id?: string | number;
    name?: string;
    tagSnippets?: Array<{ eventSnippet?: string; event_snippet?: string }>;
    tag_snippets?: Array<{ eventSnippet?: string; event_snippet?: string }>;
  };
};

@Injectable()
export class FunnelGoogleConversionUploadService {
  private readonly logger = new Logger(FunnelGoogleConversionUploadService.name);
  private readonly actionCache = new Map<
    string,
    { at: number; actions: Array<{ resourceName: string; labelHints: string[] }> }
  >();

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly googleAdsTokenService: GoogleAdsTokenService,
  ) {}

  formatConversionDateTime(unixSeconds: number): string {
    const ms = Number.isFinite(unixSeconds) ? unixSeconds * 1000 : Date.now();
    const iso = new Date(ms).toISOString();
    return iso.replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00');
  }

  isRetryableError(err: unknown): boolean {
    const message =
      err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (message.includes('rate') || message.includes('quota')) return true;
    if (message.includes('timeout') || message.includes('temporarily')) return true;
    if (message.includes('503') || message.includes('500') || message.includes('429')) {
      return true;
    }
    return false;
  }

  async resolveConversionActionResource(
    businessId: number,
    conversionLabel: string,
  ): Promise<string | null> {
    const label = conversionLabel.trim();
    if (!label) return null;

    const actions = await this.listConversionActions(businessId);
    const needle = label.toLowerCase();

    for (const action of actions) {
      if (action.labelHints.some((hint) => hint.includes(needle))) {
        return action.resourceName;
      }
    }

    for (const action of actions) {
      if (action.resourceName.endsWith(`/${label}`)) {
        return action.resourceName;
      }
    }

    return null;
  }

  async uploadClickConversion(
    row: GoogleFunnelEvent,
    conversionAction: string,
  ): Promise<Record<string, unknown>> {
    const business = await this.businessRepository.findOne({
      where: { id: row.businessId },
    });
    if (!business) {
      throw Object.assign(new Error('Business not found for Google upload'), {
        status: 404,
      });
    }

    const credentials =
      await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);
    const customerId = normalizeGoogleCustomerId(credentials.customerId ?? '');
    const loginCustomerId = normalizeGoogleCustomerId(
      credentials.loginCustomerId || customerId,
    );
    if (!customerId) {
      throw Object.assign(
        new Error('No Google Ads customer selected for this business'),
        { status: 400 },
      );
    }

    const gclid = row.gclid?.trim();
    if (!gclid) {
      throw Object.assign(new Error('Missing gclid for click conversion upload'), {
        status: 400,
      });
    }

    const client = createGoogleAdsApiClient({
      clientId: this.googleAdsTokenService.getClientId(),
      clientSecret: this.googleAdsTokenService.getClientSecret(),
      developerToken: this.googleAdsTokenService.getDeveloperToken(),
    });
    const customer = createGoogleAdsCustomer(client, {
      customerId,
      refreshToken: credentials.refreshToken,
      loginCustomerId,
    });

    const conversion: Record<string, unknown> = {
      gclid,
      conversion_action: conversionAction,
      conversion_date_time: this.formatConversionDateTime(Number(row.eventTime)),
    };

    if (row.value != null && String(row.value).trim()) {
      const valueNum = Number(row.value);
      if (Number.isFinite(valueNum)) {
        conversion.conversion_value = valueNum;
      }
    }
    if (row.currency?.trim()) {
      conversion.currency_code = row.currency.trim().toUpperCase();
    }
    if (row.transactionId?.trim()) {
      conversion.order_id = row.transactionId.trim();
    }

    const request = {
      customer_id: customerId,
      conversions: [conversion],
      partial_failure: true,
    };

    this.logger.log(
      `Google upload event_id=${row.eventId} businessId=${row.businessId} action=${conversionAction}`,
    );

    try {
      const response = await customer.conversionUploads.uploadClickConversions(
        request as never,
      );
      return (response ?? {}) as unknown as Record<string, unknown>;
    } catch (err) {
      const message = formatGoogleAdsSdkError(
        err,
        'Google Ads conversion upload failed',
      );
      const wrapped = new Error(message) as Error & {
        googleResponse?: Record<string, unknown>;
        status?: number;
      };
      wrapped.googleResponse = {
        error: message,
        raw:
          err && typeof err === 'object'
            ? (err as Record<string, unknown>)
            : String(err),
      };
      wrapped.status = 502;
      throw wrapped;
    }
  }

  private async listConversionActions(
    businessId: number,
  ): Promise<Array<{ resourceName: string; labelHints: string[] }>> {
    const cached = this.actionCache.get(String(businessId));
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) {
      return cached.actions;
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) return [];

    let credentials;
    try {
      credentials =
        await this.googleAdsTokenService.assertBusinessGoogleCredentials(business);
    } catch {
      return [];
    }

    const customerId = normalizeGoogleCustomerId(credentials.customerId ?? '');
    const loginCustomerId = normalizeGoogleCustomerId(
      credentials.loginCustomerId || customerId,
    );
    if (!customerId) return [];

    const client = createGoogleAdsApiClient({
      clientId: this.googleAdsTokenService.getClientId(),
      clientSecret: this.googleAdsTokenService.getClientSecret(),
      developerToken: this.googleAdsTokenService.getDeveloperToken(),
    });
    const customer = createGoogleAdsCustomer(client, {
      customerId,
      refreshToken: credentials.refreshToken,
      loginCustomerId,
    });

    const query = `
      SELECT
        conversion_action.resource_name,
        conversion_action.id,
        conversion_action.name,
        conversion_action.tag_snippets
      FROM conversion_action
      WHERE conversion_action.status = 'ENABLED'
    `.trim();

    let rows: ConversionActionRow[] = [];
    try {
      rows = (await customer.query(query)) as ConversionActionRow[];
    } catch (err) {
      this.logger.warn(
        `Could not list conversion actions businessId=${businessId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }

    const actions = rows
      .map((row) => {
        const action = row.conversionAction ?? row.conversion_action;
        const resourceName =
          action?.resourceName?.trim() ||
          action?.resource_name?.trim() ||
          '';
        if (!resourceName) return null;

        const snippets = action?.tagSnippets ?? action?.tag_snippets ?? [];
        const labelHints: string[] = [];
        if (action?.name?.trim()) {
          labelHints.push(action.name.trim().toLowerCase());
        }
        for (const snippet of snippets) {
          const eventSnippet =
            snippet.eventSnippet?.trim() || snippet.event_snippet?.trim() || '';
          if (!eventSnippet) continue;
          labelHints.push(eventSnippet.toLowerCase());
          const match = eventSnippet.match(/AW-[^/'"]+\/([^'"\s}]+)/i);
          if (match?.[1]) {
            labelHints.push(match[1].toLowerCase());
          }
        }

        return { resourceName, labelHints };
      })
      .filter(
        (row): row is { resourceName: string; labelHints: string[] } =>
          row != null,
      );

    this.actionCache.set(String(businessId), {
      at: Date.now(),
      actions,
    });
    return actions;
  }
}
