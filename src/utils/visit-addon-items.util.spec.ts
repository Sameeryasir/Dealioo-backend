import {
  resolveVisitStoredExtraItems,
  storedExtraItemsFromAddonRows,
} from './visit-addon-items.util';

describe('visit-addon-items.util', () => {
  it('prefers table rows over JSON extra_items', () => {
    const items = resolveVisitStoredExtraItems({
      extraItems: [{ name: 'Old JSON', unitPriceCents: 100, qty: 1 }],
      addonItems: [
        { name: 'Fries', unitPriceCents: 550, qty: 2, sortOrder: 1 },
        { name: 'Drink', unitPriceCents: 300, qty: 1, sortOrder: 0 },
      ],
    });

    expect(items).toEqual([
      { name: 'Drink', unitPriceCents: 300, qty: 1 },
      { name: 'Fries', unitPriceCents: 550, qty: 2 },
    ]);
  });

  it('falls back to JSON when table is empty', () => {
    const items = resolveVisitStoredExtraItems({
      extraItems: [{ name: 'Fries', unitPriceCents: 500, qty: 1 }],
      addonItems: [],
    });
    expect(items).toEqual([{ name: 'Fries', unitPriceCents: 500, qty: 1 }]);
  });

  it('sorts addon rows by sortOrder', () => {
    expect(
      storedExtraItemsFromAddonRows([
        { name: 'B', unitPriceCents: 200, qty: 1, sortOrder: 2 },
        { name: 'A', unitPriceCents: 100, qty: 1, sortOrder: 0 },
      ]),
    ).toEqual([
      { name: 'A', unitPriceCents: 100, qty: 1 },
      { name: 'B', unitPriceCents: 200, qty: 1 },
    ]);
  });
});
