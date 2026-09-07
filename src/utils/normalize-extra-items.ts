export type StoredExtraItem = {
  name: string;
  unitPriceCents: number;
  qty: number;
};

export type IncomingExtraItem = {
  name?: unknown;
  unitPrice?: unknown;
  unitPriceCents?: unknown;
  price?: unknown;
  qty?: unknown;
  quantity?: unknown;
};

export type ResolvedCounterExtras = {
  cents: number;
  items: StoredExtraItem[];
  labels: string[];
};

export class ExtraItemsMismatchError extends Error {
  constructor(
    message = 'Add-on total must match the sum of add-on item prices.',
  ) {
    super(message);
    this.name = 'ExtraItemsMismatchError';
  }
}

const MAX_ITEMS = 20;
const MAX_NAME_LEN = 120;
const MAX_QTY = 99;
const AMOUNT_TOLERANCE_CENTS = 1;

function clampQty(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.round(value)));
}

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function resolveUnitPriceCents(raw: IncomingExtraItem): number | null {
  if (
    typeof raw.unitPriceCents === 'number' &&
    Number.isFinite(raw.unitPriceCents) &&
    raw.unitPriceCents >= 0
  ) {
    return Math.round(raw.unitPriceCents);
  }

  const dollarCandidate =
    typeof raw.unitPrice === 'number'
      ? raw.unitPrice
      : typeof raw.price === 'number'
        ? raw.price
        : null;

  if (
    dollarCandidate != null &&
    Number.isFinite(dollarCandidate) &&
    dollarCandidate >= 0
  ) {
    return dollarsToCents(dollarCandidate);
  }

  return null;
}

export function normalizeExtraItems(
  items: IncomingExtraItem[] | null | undefined,
): StoredExtraItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const out: StoredExtraItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const name =
      typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) {
      continue;
    }
    const unitPriceCents = resolveUnitPriceCents(raw);
    if (unitPriceCents == null || unitPriceCents <= 0) {
      continue;
    }
    const qtyRaw =
      typeof raw.qty === 'number'
        ? raw.qty
        : typeof raw.quantity === 'number'
          ? raw.quantity
          : 1;
    out.push({
      name: name.slice(0, MAX_NAME_LEN),
      unitPriceCents,
      qty: clampQty(qtyRaw),
    });
    if (out.length >= MAX_ITEMS) {
      break;
    }
  }
  return out;
}

export function extraItemLabels(items: StoredExtraItem[]): string[] {
  return items.map((item) =>
    item.qty > 1 ? `${item.name} × ${item.qty}` : item.name,
  );
}

export function extraItemsTotalCents(items: StoredExtraItem[]): number {
  return items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.qty,
    0,
  );
}

export function extraItemsForApi(
  items: StoredExtraItem[] | null | undefined,
): Array<{ name: string; unitPrice: number; qty: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items.map((item) => ({
    name: item.name,
    unitPrice: Math.round(item.unitPriceCents) / 100,
    qty: item.qty,
  }));
}

export function normalizeExtraItemNames(
  names: string[] | null | undefined,
): string[] {
  if (!Array.isArray(names) || names.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') {
      continue;
    }
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name.slice(0, MAX_NAME_LEN));
    if (out.length >= MAX_ITEMS) {
      break;
    }
  }
  return out;
}

/**
 * Single source of truth for counter add-ons:
 * when line items exist, their sum owns the amount.
 */
export function resolveCounterExtras(input: {
  amountDollars?: number | null;
  items?: IncomingExtraItem[] | null;
  names?: string[] | null;
}): ResolvedCounterExtras {
  const items = normalizeExtraItems(input.items);
  const linesCents = extraItemsTotalCents(items);
  const amountCents =
    input.amountDollars != null &&
    Number.isFinite(input.amountDollars) &&
    input.amountDollars > 0
      ? dollarsToCents(input.amountDollars)
      : 0;

  if (items.length > 0) {
    if (
      amountCents > 0 &&
      Math.abs(amountCents - linesCents) > AMOUNT_TOLERANCE_CENTS
    ) {
      throw new ExtraItemsMismatchError();
    }
    return {
      cents: linesCents,
      items,
      labels: extraItemLabels(items),
    };
  }

  if (amountCents > 0) {
    return {
      cents: amountCents,
      items: [],
      labels: normalizeExtraItemNames(input.names),
    };
  }

  return { cents: 0, items: [], labels: [] };
}

/** Prefer line-item sum for Orders display; fall back to visit order_subtotal. */
export function visitAddOnAmountDollars(input: {
  orderSubtotal?: number | null;
  extraItems?: Array<{ name: string; unitPrice: number; qty: number }> | null;
}): number | null {
  const items = Array.isArray(input.extraItems) ? input.extraItems : [];
  if (items.length > 0) {
    const cents = items.reduce((sum, item) => {
      const unit =
        typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)
          ? Math.round(item.unitPrice * 100)
          : 0;
      const qty =
        typeof item.qty === 'number' && Number.isFinite(item.qty)
          ? Math.max(1, Math.round(item.qty))
          : 1;
      return sum + unit * qty;
    }, 0);
    return cents > 0 ? Math.round(cents) / 100 : null;
  }

  if (input.orderSubtotal != null && Number(input.orderSubtotal) > 0) {
    return Math.round(Number(input.orderSubtotal) * 100) / 100;
  }

  return null;
}

export function extraItemsFingerprint(items: StoredExtraItem[]): string {
  return items
    .map((item) => `${item.name}:${item.unitPriceCents}x${item.qty}`)
    .join('|');
}
