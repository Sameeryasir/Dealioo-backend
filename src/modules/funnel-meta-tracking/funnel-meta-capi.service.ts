import { Injectable, Logger } from '@nestjs/common';
import { MetaFunnelEvent } from '../../db/entities/meta-funnel-event.entity';

type MetaCapiUserData = {
  em?: string[];
  ph?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
};

type MetaCapiEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: MetaCapiUserData;
  custom_data?: Record<string, unknown>;
};

@Injectable()
export class FunnelMetaCapiService {
  private readonly logger = new Logger(FunnelMetaCapiService.name);

  getGraphVersion(): string {
    return process.env.RP_META_GRAPH_API_VERSION?.trim() || 'v21.0';
  }

  getTestEventCode(): string | undefined {
    const code = process.env.RP_META_CAPI_TEST_EVENT_CODE?.trim();
    return code || undefined;
  }

  buildCapiPayload(row: MetaFunnelEvent): {
    data: MetaCapiEvent[];
    test_event_code?: string;
  } {
    const userDataFromRow = (row.userData ?? {}) as {
      em?: unknown;
      ph?: unknown;
      external_id?: unknown;
    };
    const user_data: MetaCapiUserData = {};

    const em = userDataFromRow.em;
    const ph = userDataFromRow.ph;
    const externalId = userDataFromRow.external_id;

    if (Array.isArray(em) && em.length) user_data.em = em.map(String);
    if (Array.isArray(ph) && ph.length) user_data.ph = ph.map(String);
    if (Array.isArray(externalId) && externalId.length) {
      user_data.external_id = externalId.map(String);
    }
    if (row.fbp) user_data.fbp = row.fbp;
    if (row.fbc) user_data.fbc = row.fbc;
    if (row.clientIp) user_data.client_ip_address = row.clientIp;
    if (row.userAgent) user_data.client_user_agent = row.userAgent;

    const event: MetaCapiEvent = {
      event_name: row.eventName,
      event_time: Number(row.eventTime),
      event_id: row.eventId,
      action_source: row.actionSource || 'website',
      user_data,
    };

    if (row.eventSourceUrl) event.event_source_url = row.eventSourceUrl;
    if (
      row.customData &&
      typeof row.customData === 'object' &&
      Object.keys(row.customData).length > 0
    ) {
      event.custom_data = row.customData as Record<string, unknown>;
    }

    const body: { data: MetaCapiEvent[]; test_event_code?: string } = {
      data: [event],
    };
    const testCode = this.getTestEventCode();
    if (testCode) body.test_event_code = testCode;
    return body;
  }

  async sendEvent(
    row: MetaFunnelEvent,
    credentials: { pixelId: string; accessToken: string },
  ): Promise<Record<string, unknown>> {
    const pixelId = credentials.pixelId.trim();
    const token = credentials.accessToken.trim();
    if (!pixelId || !token) {
      throw new Error(
        'Funnel CAPI requires business pixelId and access token.',
      );
    }

    const version = this.getGraphVersion();
    const body = this.buildCapiPayload(row);
    const url = new URL(
      `https://graph.facebook.com/${version}/${pixelId}/events`,
    );
    url.searchParams.set('access_token', token);

    this.logger.log(
      `Funnel CAPI send event_id=${row.eventId} name=${row.eventName} businessId=${row.businessId} pixel=${pixelId}`,
    );

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const message =
        typeof json.error === 'object' &&
        json.error &&
        'message' in (json.error as object)
          ? String((json.error as { message?: string }).message)
          : `Meta CAPI HTTP ${response.status}`;
      const err = new Error(message) as Error & {
        metaResponse?: Record<string, unknown>;
        status?: number;
      };
      err.metaResponse = json;
      err.status = response.status;
      throw err;
    }

    return json;
  }

  isRetryableError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return true;
    const status = (err as { status?: number }).status;
    if (status == null) return true;
    if (status === 429) return true;
    if (status >= 500) return true;
    return false;
  }
}
