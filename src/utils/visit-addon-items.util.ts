import { EntityManager } from 'typeorm';
import {
  VisitAddonItem,
  VisitAddonItemSource,
} from '../db/entities/visit-addon-item.entity';
import type { StoredExtraItem } from './normalize-extra-items';

export type ReplaceVisitAddonItemsParams = {
  customerVisitId: number;
  businessId: number;
  customerId: number;
  items: StoredExtraItem[];
  orderId?: number | null;
  funnelPaymentId?: number | null;
  campaignId?: number | null;
  staffUserId?: number | null;
  source?: VisitAddonItemSource | string | null;
  currency?: string;
};

export function storedExtraItemsFromAddonRows(
  rows: Array<Pick<VisitAddonItem, 'name' | 'unitPriceCents' | 'qty' | 'sortOrder'>> | null | undefined,
): StoredExtraItem[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      name: row.name,
      unitPriceCents: Math.max(0, Math.round(Number(row.unitPriceCents) || 0)),
      qty: Math.max(1, Math.round(Number(row.qty) || 1)),
    }))
    .filter((row) => row.name.trim() && row.unitPriceCents > 0);
}

export function resolveVisitStoredExtraItems(visit: {
  extraItems?: StoredExtraItem[] | null;
  addonItems?: Array<
    Pick<VisitAddonItem, 'name' | 'unitPriceCents' | 'qty' | 'sortOrder'>
  > | null;
}): StoredExtraItem[] {
  const fromTable = storedExtraItemsFromAddonRows(visit.addonItems);
  if (fromTable.length > 0) {
    return fromTable;
  }
  return Array.isArray(visit.extraItems) ? visit.extraItems : [];
}

export async function replaceVisitAddonItems(
  manager: EntityManager,
  params: ReplaceVisitAddonItemsParams,
): Promise<void> {
  await manager.delete(VisitAddonItem, {
    customerVisitId: params.customerVisitId,
  });

  if (!Array.isArray(params.items) || params.items.length === 0) {
    return;
  }

  const rows = params.items.map((item, index) =>
    manager.create(VisitAddonItem, {
      customerVisitId: params.customerVisitId,
      businessId: params.businessId,
      customerId: params.customerId,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      qty: item.qty,
      lineTotalCents: item.unitPriceCents * item.qty,
      sortOrder: index,
      orderId: params.orderId ?? null,
      funnelPaymentId: params.funnelPaymentId ?? null,
      campaignId: params.campaignId ?? null,
      staffUserId: params.staffUserId ?? null,
      source: params.source ?? null,
      currency: params.currency ?? 'usd',
    }),
  );

  await manager.save(VisitAddonItem, rows);
}
