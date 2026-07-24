import { MetaApiStepError } from './facebook-campaign-meta';

const TRANSIENT_META_CODES = new Set([
  1, 
  2, 
  4, 
  17, 
  32, 
  613, 
  80001,
  80004,
]);

const NON_RETRYABLE_META_CODES = new Set([
  190, 
  10, 
  200, 
  294, 
]);

function extractStatusCode(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
  if (typeof anyErr.response?.status === 'number') return anyErr.response.status;
  return null;
}

function extractMetaCode(err: unknown): number | null {
  if (err instanceof MetaApiStepError) {
    return err.metaErrorCode;
  }
  if (!err || typeof err !== 'object') return null;
  const code = (err as { metaErrorCode?: unknown }).metaErrorCode;
  return typeof code === 'number' ? code : null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? '');
}

export function isTransientMetaPublishError(err: unknown): boolean {
  const message = messageOf(err).toLowerCase();
  const metaCode = extractMetaCode(err);
  const httpStatus = extractStatusCode(err);

  if (metaCode != null && NON_RETRYABLE_META_CODES.has(metaCode)) {
    return false;
  }

  if (
    message.includes('reconnect facebook') ||
    (message.includes('token') && message.includes('expired')) ||
    message.includes('permission') ||
    message.includes('oauth') ||
    (message.includes('disabled') && message.includes('ad account')) ||
    message.includes('not linked to this meta account') ||
    (message.includes('invalid') &&
      (message.includes('creative') ||
        message.includes('page') ||
        message.includes('targeting') ||
        message.includes('objective') ||
        message.includes('budget'))) ||
    message.includes('unsupported creative') ||
    message.includes('carousel video cards are not supported') ||
    message.includes('landing page url is required') ||
    message.includes('complete all builder steps')
  ) {
    return false;
  }

  if (metaCode != null && TRANSIENT_META_CODES.has(metaCode)) {
    return true;
  }

  if (httpStatus != null && httpStatus >= 500) {
    return true;
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('socket hang up') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('temporar') ||
    message.includes('try again')
  ) {
    return true;
  }

  if (httpStatus === 429) {
    return true;
  }

  
  if (err instanceof MetaApiStepError) {
    return false;
  }

  return false;
}
