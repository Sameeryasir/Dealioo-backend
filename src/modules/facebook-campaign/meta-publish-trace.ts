import { Logger } from '@nestjs/common';
import type { MetaCreationStep } from './meta-campaign.constants';

const logger = new Logger('MetaPublishTrace');

export function sanitizeMetaPayload(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'access_token' || key === 'bytes') {
      out[key] = key === 'bytes' ? `[base64 ${String(value).length} chars]` : '[redacted]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logMetaPublishStep(
  step: MetaCreationStep | string,
  phase: 'start' | 'success' | 'error',
  details?: Record<string, unknown>,
): void {
  const prefix = `[MetaPublish:${step}]`;
  if (phase === 'start') {
    logger.log(`${prefix} START ${details ? JSON.stringify(details) : ''}`);
  } else if (phase === 'success') {
    logger.log(`${prefix} SUCCESS ${details ? JSON.stringify(details) : ''}`);
  } else {
    logger.error(`${prefix} FAILED ${details ? JSON.stringify(details) : ''}`);
  }
}

export function logMetaApiRequest(
  step: MetaCreationStep | string,
  method: 'GET' | 'POST',
  path: string,
  payload?: Record<string, unknown>,
): void {
  logger.log(
    `[MetaPublish:${step}] ${method} ${path}${
      payload ? ` payload=${JSON.stringify(sanitizeMetaPayload(payload))}` : ''
    }`,
  );
}

export function logMetaApiResponse(
  step: MetaCreationStep | string,
  httpStatus: number,
  body: unknown,
): void {
  const text =
    typeof body === 'string' ? body : JSON.stringify(body);
  const truncated = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  logger.log(`[MetaPublish:${step}] response status=${httpStatus} body=${truncated}`);
}
