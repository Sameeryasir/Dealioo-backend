export function dollarsToCents(dollars: number): number {
  return Math.round(Number(dollars) * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(Number(cents)) / 100;
}

export function dollarsEqualInCents(a: number, b: number): boolean {
  return dollarsToCents(a) === dollarsToCents(b);
}

export function assertNonNegativeCents(cents: number, label = 'Amount'): number {
  const value = Math.round(Number(cents));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer (cents).`);
  }
  return value;
}
