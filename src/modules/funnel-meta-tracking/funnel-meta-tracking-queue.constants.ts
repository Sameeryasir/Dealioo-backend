export const FUNNEL_META_CAPI_QUEUE = 'funnel-meta-capi';

export enum FunnelMetaCapiJobName {
  SEND_EVENT = 'send-event',
}

export type FunnelMetaCapiJobPayload = {
  eventRowId: string;
  eventId: string;
};

export function funnelMetaCapiJobId(eventId: string): string {
  return `funnel-meta-capi-${eventId}`;
}
