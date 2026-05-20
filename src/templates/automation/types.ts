export type AutomationEmailTemplateProps = {
  customerName: string;
  customerEmail: string;
  subject: string;
  headline?: string;
  message?: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

export type AutomationEmailRenderResult = {
  html: string;
  text: string;
};
