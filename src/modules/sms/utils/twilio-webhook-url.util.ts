import type { Request } from 'express';

export function resolveTwilioWebhookUrls(req: Request): string[] {
  const configured = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim();
  const forwardedProto = req.headers['x-forwarded-proto']?.toString();
  const protocol =
    forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http';
  const forwardedHost = req.headers['x-forwarded-host']?.toString();
  const host =
    forwardedHost?.split(',')[0]?.trim() || req.get('host')?.trim() || '';
  const requestUrl = `${protocol}://${host}${req.originalUrl}`;

  return [...new Set([configured, requestUrl].filter(Boolean))] as string[];
}
