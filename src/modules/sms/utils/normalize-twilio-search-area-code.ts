export function twilioCountrySupportsAreaCode(
  countryCode: string | null | undefined,
): boolean {
  const code = countryCode?.trim().toUpperCase() || '';
  return code === 'US' || code === 'CA';
}

export function normalizeTwilioSearchAreaCode(
  countryCode: string | null | undefined,
  areaCode: string | null | undefined,
): string | undefined {
  if (!twilioCountrySupportsAreaCode(countryCode)) {
    return undefined;
  }

  const raw = areaCode?.trim() || '';
  if (!/^\d{3}$/.test(raw)) {
    return undefined;
  }

  return raw;
}
