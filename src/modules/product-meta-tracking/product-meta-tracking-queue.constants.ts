export const PRODUCT_META_CAPI_QUEUE = 'product-meta-capi';

export enum ProductMetaCapiJobName {
  SEND_EVENT = 'send-event',
}

export type ProductMetaCapiJobPayload = {
  eventRowId: string;
  eventId: string;
};

export function productMetaCapiJobId(eventId: string): string {
  return `product-meta-capi-${eventId}`;
}
