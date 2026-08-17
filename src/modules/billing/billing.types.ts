export type UpgradeSubscriptionResponse = {
  success: true;
  subscriptionId: string;
  customerId: string | null;
  oldPriceId: string;
  newPriceId: string;
  status: string;
  latestInvoice: string | null;
  paymentIntentClientSecret: string | null;
};

export type BillingPortalResponse = {
  url: string;
};

export type BillingPaymentMethod = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type BillingAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type BillingDetails = {
  name: string | null;
  email: string | null;
  address: BillingAddress | null;
};

export type BillingInvoice = {
  id: string;
  number: string | null;
  createdAt: string;
  amountFormatted: string;
  currency: string;
  status: string;
};

export type BillingInvoiceLinksResponse = {
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
};

export type BillingInvoicePdfFile = {
  buffer: Buffer;
  filename: string;
};

export type BillingSubscriptionSummary = {
  planName: string;
  planSlug: string;
  billingCycle: 'monthly' | 'annual';
  status: string;
  priceFormatted: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationDate: string | null;
  startedAt: string | null;
};

export type BillingOverviewResponse = {
  subscription: BillingSubscriptionSummary | null;
  paymentMethod: BillingPaymentMethod | null;
  billingDetails: BillingDetails;
  invoices: BillingInvoice[];
};

export type BillingSetupIntentResponse = {
  clientSecret: string;
};

export type BillingPaymentMethodUpdateResponse = {
  success: true;
  paymentMethod: BillingPaymentMethod | null;
};

export type BillingDetailsUpdateResponse = {
  success: true;
  billingDetails: BillingDetails;
};

export type ResumeSubscriptionResponse = {
  success: true;
  cancelAtPeriodEnd: false;
  status: string;
};
