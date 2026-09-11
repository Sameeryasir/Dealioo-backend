export enum GoogleFunnelEventStatus {
  STORED = 'stored',
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter',
}

export enum GoogleFunnelEventName {
  PAGE_VIEW = 'page_view',
  BUTTON_CLICK = 'button_click',
  GENERATE_LEAD = 'generate_lead',
  SIGN_UP = 'sign_up',
  BEGIN_CHECKOUT = 'begin_checkout',
  PURCHASE = 'purchase',
  CONVERSION = 'conversion',
}
