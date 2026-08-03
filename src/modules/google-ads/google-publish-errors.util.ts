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

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? '');
}

export function isTransientGooglePublishError(err: unknown): boolean {
  const message = messageOf(err).toLowerCase();
  const httpStatus = extractStatusCode(err);

  if (
    message.includes('reconnect google') ||
    message.includes('not connected') ||
    message.includes('no google ads account selected') ||
    message.includes('customer account') ||
    (message.includes('token') && message.includes('expired')) ||
    message.includes('permission') ||
    message.includes('oauth') ||
    message.includes('complete all required builder steps') ||
    message.includes('draft failed publish validation') ||
    message.includes('not wired yet')
  ) {
    return false;
  }

  if (httpStatus != null && httpStatus >= 500) {
    return true;
  }

  if (httpStatus === 429) {
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
    message.includes('try again') ||
    message.includes('unavailable')
  ) {
    return true;
  }

  return false;
}
