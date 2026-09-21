export type CampaignFunnelPageCopy = {
  pageTitle: string;
  headline: string;
  subheadline: string;
  body: string;
  ctaLabel: string;
};

export type CampaignFunnelCopyInput = {
  campaignName: string;
  offer?: string | null;
  description?: string | null;
};

function cleanText(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function buildLandingBody(params: {
  name: string;
  offer: string;
  description: string | null | undefined;
}): string {
  const detail = params.description?.trim();
  const detailSentence =
    detail && detail.length > 0
      ? detail.endsWith('.')
        ? detail
        : `${detail}.`
      : `${params.offer} is one of our guest favorites right now.`;

  return [
    detailSentence,
    `When you claim ${params.name}, you lock in the deal before it sells out and skip the usual back-and-forth.`,
    `It only takes a minute to join — pick your offer, share a few details, and we'll have everything ready for your visit.`,
    `Perfect for a quick treat, a planned night out, or sharing with friends. Tap below to get started with ${params.offer}.`,
  ].join(' ');
}

export function buildCampaignFunnelCopy(input: CampaignFunnelCopyInput): {
  landing: CampaignFunnelPageCopy;
  signup: CampaignFunnelPageCopy;
  payment: CampaignFunnelPageCopy;
  confirmation: CampaignFunnelPageCopy;
} {
  const name = cleanText(input.campaignName, 'this offer');
  const offer = cleanText(input.offer, name);
  const landingBody = buildLandingBody({
    name,
    offer,
    description: input.description,
  });

  return {
    landing: {
      pageTitle: name,
      headline: name,
      subheadline: `A limited guest offer for ${offer} — claim it online and enjoy it in-store.`,
      body: landingBody,
      ctaLabel: `Get ${name}`,
    },
    signup: {
      pageTitle: `Join for ${name}`,
      headline: `Almost yours — ${name}`,
      subheadline: 'Enter your details so we can save your spot.',
      body: `Create your guest profile to unlock ${offer}. It only takes a moment.`,
      ctaLabel: 'Continue',
    },
    payment: {
      pageTitle: `Pay for ${name}`,
      headline: `Complete checkout for ${name}`,
      subheadline: 'Secure payment. Your offer is held while you finish.',
      body: `You're one step away from ${offer}. Confirm payment to lock it in.`,
      ctaLabel: 'Pay now',
    },
    confirmation: {
      pageTitle: `${name} confirmed`,
      headline: `You're in — ${name} is ready`,
      subheadline: 'Thanks for joining. Check your email for next steps.',
      body: `Your spot for ${offer} is confirmed. Show this confirmation when you visit, or follow the instructions we sent you.`,
      ctaLabel: 'Done',
    },
  };
}

export function buildCampaignFunnelPageSchemas(
  input: CampaignFunnelCopyInput,
  options?: { includePaymentPage?: boolean },
): Record<string, Record<string, unknown>> {
  const copy = buildCampaignFunnelCopy(input);
  const includePaymentPage = options?.includePaymentPage !== false;
  const pages: Record<string, Record<string, unknown>> = {
    landing: { ...copy.landing },
    signup: { ...copy.signup },
    confirmation: { ...copy.confirmation },
  };
  if (includePaymentPage) {
    pages.payment = { ...copy.payment };
  }
  return pages;
}
