/**
 * Change: Detail response for GET /business/:id includes Business summary metrics.
 * Why: Settings profile card needs campaigns/customers/automations/usage in one round-trip.
 * Related: business.service.ts getBusinessById, sanitize-business-list-item.ts
 */

import { Business } from '../../db/entities/business.entity';
import {
  sanitizeBusinessListItem,
  type PublicBusinessListItem,
} from './sanitize-business-list-item';

export type BusinessSummaryMetrics = {
  totalCampaigns: number;
  totalCustomers: number;
  activeAutomations: number;
  /** Profile completeness 0–100 until a real plan usage meter exists. */
  monthlyUsagePercent: number;
};

export type BusinessDetailResponse = PublicBusinessListItem & {
  summary: BusinessSummaryMetrics;
  owner?: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export function computeProfileCompletenessPercent(business: Business): number {
  const checks = [
    Boolean(business.name?.trim()),
    Boolean(business.phoneNumber?.trim()),
    Boolean(business.email?.trim()),
    Boolean(business.websiteUrl?.trim()),
    Boolean(business.city?.trim()),
    Boolean(business.country?.trim()),
    Boolean(business.description?.trim()),
    Boolean(business.logoUrl?.trim()),
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

export function toBusinessDetailResponse(
  business: Business,
  summary: Omit<BusinessSummaryMetrics, 'monthlyUsagePercent'> & {
    monthlyUsagePercent?: number;
  },
): BusinessDetailResponse {
  const base = sanitizeBusinessListItem(business);
  const owner = business.owner
    ? {
        id: business.owner.id,
        name: business.owner.name ?? null,
        email: business.owner.email ?? null,
        phone: business.owner.phone ?? null,
      }
    : null;

  return {
    ...base,
    owner,
    summary: {
      totalCampaigns: summary.totalCampaigns,
      totalCustomers: summary.totalCustomers,
      activeAutomations: summary.activeAutomations,
      monthlyUsagePercent:
        summary.monthlyUsagePercent ??
        computeProfileCompletenessPercent(business),
    },
  };
}
