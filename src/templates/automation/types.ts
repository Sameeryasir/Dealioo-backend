export type AutomationEmailTemplateProps = {
  customerName: string;
  customerEmail: string;
  subject: string;
  headline?: string;
  message?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  directBody?: boolean;
  /** Base64 data-URL for the guest coupon QR (prepaid / payment emails). */
  qrImageDataUrl?: string;
};


export type AutomationEmailRenderResult = {
  html: string;
  text: string;
};
