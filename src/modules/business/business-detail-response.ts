import { Business } from '../../db/entities/business.entity';
import { computeBusinessSetupProgressFromEntity } from './business-setup-progress';
import {
  sanitizeBusinessListItem,
  type PublicBusinessListItem,
} from './sanitize-business-list-item';

export type BusinessSummaryMetrics = {
  totalCampaigns: number;
  totalCustomers: number;
  activeAutomations: number;
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
  const item = sanitizeBusinessListItem(business);
  return item.setupProgressPercent;
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
        computeBusinessSetupProgressFromEntity(business, {
          stripeConnected: base.stripeConnected,
          metaConnected: base.metaConnected,
          googleAdsConnected: base.googleAdsConnected,
          twilioConnected: base.twilioConnected,
        }),
    },
  };
}
