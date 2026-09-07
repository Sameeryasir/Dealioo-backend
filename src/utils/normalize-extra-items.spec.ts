import {
  ExtraItemsMismatchError,
  extraItemsFingerprint,
  extraItemsTotalCents,
  normalizeExtraItems,
  resolveCounterExtras,
  visitAddOnAmountDollars,
} from './normalize-extra-items';

describe('normalize-extra-items', () => {
  it('normalizes dollar unit prices into cents with qty clamps', () => {
    const items = normalizeExtraItems([
      { name: '  Fries  ', unitPrice: 5.5, qty: 2 },
      { name: 'Drink', unitPrice: 3, quantity: 100 },
      { name: '', unitPrice: 9 },
      { name: 'Skip', unitPrice: 0 },
    ]);

    expect(items).toEqual([
      { name: 'Fries', unitPriceCents: 550, qty: 2 },
      { name: 'Drink', unitPriceCents: 300, qty: 99 },
    ]);
    expect(extraItemsTotalCents(items)).toBe(550 * 2 + 300 * 99);
  });

  it('uses line-item sum as the money source of truth', () => {
    const resolved = resolveCounterExtras({
      amountDollars: 11,
      items: [
        { name: 'Fries', unitPrice: 5, qty: 1 },
        { name: 'Drink', unitPrice: 3, qty: 2 },
      ],
    });

    expect(resolved.cents).toBe(1100);
    expect(resolved.labels).toEqual(['Fries', 'Drink × 2']);
  });

  it('rejects mismatched add-on amount vs line items', () => {
    expect(() =>
      resolveCounterExtras({
        amountDollars: 50,
        items: [{ name: 'Fries', unitPrice: 5, qty: 1 }],
      }),
    ).toThrow(ExtraItemsMismatchError);
  });

  it('allows amount-only legacy extras without line items', () => {
    const resolved = resolveCounterExtras({
      amountDollars: 12.5,
      names: ['Mystery bag', 'Mystery bag'],
    });

    expect(resolved).toEqual({
      cents: 1250,
      items: [],
      labels: ['Mystery bag'],
    });
  });

  it('prefers line-item totals for visit display amounts', () => {
    expect(
      visitAddOnAmountDollars({
        orderSubtotal: 99,
        extraItems: [
          { name: 'Fries', unitPrice: 5, qty: 1 },
          { name: 'Drink', unitPrice: 3, qty: 2 },
        ],
      }),
    ).toBe(11);

    expect(
      visitAddOnAmountDollars({
        orderSubtotal: 17,
        extraItems: [],
      }),
    ).toBe(17);
  });

  it('builds a stable extras fingerprint for idempotency', () => {
    expect(
      extraItemsFingerprint([
        { name: 'Fries', unitPriceCents: 500, qty: 1 },
        { name: 'Drink', unitPriceCents: 300, qty: 2 },
      ]),
    ).toBe('Fries:500x1|Drink:300x2');
  });
});
