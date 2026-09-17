import { BadRequestException } from '@nestjs/common';

export function resolveTwilioCountryCode(input: string | null | undefined): string {
  const raw = input?.trim() || '';
  if (!raw) {
    return 'US';
  }

  if (/^[A-Za-z]{2}$/.test(raw)) {
    return raw.toUpperCase();
  }

  throw new BadRequestException(
    `Country must be a 2-letter code like US, CA, or PK. Received "${raw}".`,
  );
}
