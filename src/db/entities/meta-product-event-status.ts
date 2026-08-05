export enum MetaProductEventStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  DEAD_LETTER = 'dead_letter',
}

export enum MetaProductEventName {
  PAGE_VIEW = 'PageView',
  IMPRESSION = 'Impression',
  BUTTON_CLICKED = 'ButtonClicked',
  LEAD = 'Lead',
  SUBSCRIBE = 'Subscribe',
  PURCHASE = 'Purchase',
  SUBSCRIPTION_STARTED = 'SubscriptionStarted',
  COMPLETE_REGISTRATION = 'CompleteRegistration',
  VIEW_CONTENT = 'ViewContent',
  CONTACT = 'Contact',
  SCHEDULE = 'Schedule',
}
