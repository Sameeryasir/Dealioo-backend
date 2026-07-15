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
