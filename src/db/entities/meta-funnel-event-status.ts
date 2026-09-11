export enum MetaFunnelEventStatus {
  STORED = 'stored',
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter',
}

export enum MetaFunnelEventName {
  PAGE_VIEW = 'PageView',
  VIEW_CONTENT = 'ViewContent',
  BUTTON_CLICKED = 'ButtonClicked',
  LEAD = 'Lead',
  COMPLETE_REGISTRATION = 'CompleteRegistration',
  INITIATE_CHECKOUT = 'InitiateCheckout',
  SUBSCRIBE = 'Subscribe',
  PURCHASE = 'Purchase',
}
