import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DASHBOARD_CACHE_TTL_MS,
  dashboardTtlCache,
} from '../../common/ttl-cache';
import { Campaign } from '../../db/entities/campaign.entity';
import { VisitAddonItem } from '../../db/entities/visit-addon-item.entity';

const MIN_CLEAR_TOP_VISITS = 3;
const MIN_LIFT_FOR_STRONG = 1.25;
const SCORE_TIE_EPSILON = 0.05;
const EXCLUSIVE_ADDON_LIFT = 3;
const MAX_LIFT = 10;

export type CampaignAddonTopStatus = 'clear' | 'tied' | 'emerging';

export type CampaignAddonCountItem = {
  name: string;
  times: number;
  visitCount: number;
};

export type CampaignAddonCounts = {
  campaignId: number;
  campaignName: string;
  imageUrl: string | null;
  totalAddonPurchases: number;
  totalAddonVisits: number;
  topStatus: CampaignAddonTopStatus;
  topAddonName: string | null;
  addons: CampaignAddonCountItem[];
};

export type AddonSuggestionItem = {
  rank: number;
  addonName: string;
  timesPurchased: number;
  visitCount: number;
  sharePercent: number;
  visitSharePercent: number;
  lift: number;
  score: number;
  priority: 'high' | 'medium' | 'low';
  isTiedForTop: boolean;
  isClearTop: boolean;
  message: string;
};

export type CampaignAddonSuggestions = {
  campaignId: number;
  campaignName: string;
  imageUrl: string | null;
  totalAddonPurchases: number;
  totalAddonVisits: number;
  topStatus: CampaignAddonTopStatus;
  topAddonName: string | null;
  totalSuggestions: number;
  suggestions: AddonSuggestionItem[];
};

export type AddonSuggestionPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type AggregatedRow = {
  addonName: string;
  addonKey: string;
  times: number;
  visitCount: number;
  revenueCents: number;
};

type AggregatedCampaign = {
  campaignId: number;
  campaignName: string;
  imageUrl: string | null;
    distinctVisitCount: number;
  rows: AggregatedRow[];
};

type ScoredRow = AggregatedRow & {
  sharePercent: number;
  visitSharePercent: number;
  lift: number;
  score: number;
};

type GlobalAddonStats = {
  totalTimes: number;
  byKey: Map<string, number>;
};

@Injectable()
export class AddonSuggestionService {
  constructor(
    @InjectRepository(VisitAddonItem)
    private readonly visitAddonItemRepository: Repository<VisitAddonItem>,
  ) {}

  async getAddonCountsByCampaign(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    campaignId?: number | null;
    limit?: number;
  }): Promise<{
    businessId: number;
    from: string | null;
    to: string | null;
    campaigns: CampaignAddonCounts[];
  }> {
    const cacheKey = [
      'addon-counts-v2',
      params.businessId,
      params.from?.toISOString() ?? '',
      params.to?.toISOString() ?? '',
      params.campaignId ?? '',
      params.limit ?? 20,
    ].join(':');

    return dashboardTtlCache.getOrSet(cacheKey, DASHBOARD_CACHE_TTL_MS, async () => {
      const [aggregated, globalStats] = await Promise.all([
        this.loadAggregatedCampaigns(params),
        this.loadGlobalAddonStats({
          businessId: params.businessId,
          from: params.from,
          to: params.to,
        }),
      ]);
      const limitPerCampaign = Math.min(
        100,
        Math.max(1, Math.round(params.limit ?? 20)),
      );

      const campaigns: CampaignAddonCounts[] = aggregated.map((campaign) => {
        const totalAddonPurchases = campaign.rows.reduce(
          (sum, row) => sum + row.times,
          0,
        );
        const scoredRows = this.sortRowsByScore(
          campaign.rows.map((row) =>
            this.scoreRow(row, totalAddonPurchases, campaign, globalStats),
          ),
        );
        const sortedByVolume = this.sortRowsByVolume(campaign.rows);
        const addons = sortedByVolume.slice(0, limitPerCampaign).map((row) => ({
          name: row.addonName,
          times: row.times,
          visitCount: row.visitCount,
        }));
        const topMeta = this.resolveTopMetaFromScored(scoredRows);

        return {
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          imageUrl: campaign.imageUrl,
          totalAddonPurchases,
          totalAddonVisits: campaign.distinctVisitCount,
          topStatus: topMeta.topStatus,
          topAddonName: topMeta.topAddonName,
          addons,
        };
      });

      return {
        businessId: params.businessId,
        from: params.from ? params.from.toISOString() : null,
        to: params.to ? params.to.toISOString() : null,
        campaigns: this.sortCampaignsByBest(campaigns),
      };
    });
  }

  async getSuggestionsByCampaign(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    campaignId?: number | null;
    limit?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{
    businessId: number;
    from: string | null;
    to: string | null;
    campaigns: CampaignAddonSuggestions[];
    pagination: AddonSuggestionPagination;
  }> {
    const pageSize = Math.min(
      50,
      Math.max(1, Math.round(params.pageSize ?? params.limit ?? 10)),
    );
    const page = Math.max(1, Math.round(params.page ?? 1));

    const cacheKey = [
      'addon-suggestions-v2',
      params.businessId,
      params.from?.toISOString() ?? '',
      params.to?.toISOString() ?? '',
      params.campaignId ?? '',
    ].join(':');

    const full = await dashboardTtlCache.getOrSet(
      cacheKey,
      DASHBOARD_CACHE_TTL_MS,
      () => this.computeSuggestionsByCampaign(params),
    );

    return this.paginateSuggestions(full, page, pageSize, params.campaignId);
  }

  private paginateSuggestions(
    full: {
      businessId: number;
      from: string | null;
      to: string | null;
      campaigns: CampaignAddonSuggestions[];
    },
    page: number,
    pageSize: number,
    campaignId?: number | null,
  ): {
    businessId: number;
    from: string | null;
    to: string | null;
    campaigns: CampaignAddonSuggestions[];
    pagination: AddonSuggestionPagination;
  } {
    if (campaignId != null && campaignId > 0) {
      const campaign = full.campaigns[0] ?? null;
      if (!campaign) {
        return {
          ...full,
          campaigns: [],
          pagination: {
            page: 1,
            pageSize,
            totalItems: 0,
            totalPages: 0,
          },
        };
      }

      const totalItems = campaign.totalSuggestions;
      const totalPages =
        totalItems === 0 ? 0 : Math.max(1, Math.ceil(totalItems / pageSize));
      const safePage =
        totalPages === 0 ? 1 : Math.min(page, Math.max(1, totalPages));
      const start = (safePage - 1) * pageSize;

      return {
        businessId: full.businessId,
        from: full.from,
        to: full.to,
        campaigns: [
          {
            ...campaign,
            suggestions: campaign.suggestions.slice(start, start + pageSize),
          },
        ],
        pagination: {
          page: safePage,
          pageSize,
          totalItems,
          totalPages,
        },
      };
    }

    const totalItems = full.campaigns.length;
    const totalPages =
      totalItems === 0 ? 0 : Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage =
      totalPages === 0 ? 1 : Math.min(page, Math.max(1, totalPages));
    const start = (safePage - 1) * pageSize;
    const pageCampaigns = full.campaigns
      .slice(start, start + pageSize)
      .map((campaign) => ({
        ...campaign,
        suggestions: campaign.suggestions.slice(0, pageSize),
      }));

    return {
      businessId: full.businessId,
      from: full.from,
      to: full.to,
      campaigns: pageCampaigns,
      pagination: {
        page: safePage,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  private async computeSuggestionsByCampaign(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    campaignId?: number | null;
  }): Promise<{
    businessId: number;
    from: string | null;
    to: string | null;
    campaigns: CampaignAddonSuggestions[];
  }> {
    const [aggregated, globalStats] = await Promise.all([
      this.loadAggregatedCampaigns(params),
      this.loadGlobalAddonStats({
        businessId: params.businessId,
        from: params.from,
        to: params.to,
      }),
    ]);

    const campaignsFull: CampaignAddonSuggestions[] = aggregated.map(
      (campaign) => {
        const totalAddonPurchases = campaign.rows.reduce(
          (sum, row) => sum + row.times,
          0,
        );
        const totalAddonVisits = campaign.distinctVisitCount;
        const visitShareDenominator = campaign.rows.reduce(
          (sum, row) => sum + row.visitCount,
          0,
        );

        const scoredRows = this.sortRowsByScore(
          campaign.rows.map((row) =>
            this.scoreRow(
              row,
              totalAddonPurchases,
              campaign,
              globalStats,
              visitShareDenominator,
            ),
          ),
        );

        const topMeta = this.resolveTopMetaFromScored(scoredRows);
        const topScore = scoredRows[0]?.score ?? 0;

        const allSuggestions = scoredRows.map((row) => {
          const rank =
            1 +
            scoredRows.filter(
              (other) => other.score > row.score + SCORE_TIE_EPSILON,
            ).length;
          const isTiedForTop =
            topMeta.topStatus === 'tied' &&
            Math.abs(row.score - topScore) <= SCORE_TIE_EPSILON;
          const isClearTop =
            topMeta.topStatus === 'clear' &&
            row.addonName === topMeta.topAddonName;

          return {
            rank,
            addonName: row.addonName,
            timesPurchased: row.times,
            visitCount: row.visitCount,
            sharePercent: row.sharePercent,
            visitSharePercent: row.visitSharePercent,
            lift: row.lift,
            score: row.score,
            priority: this.resolvePriority({
              isClearTop,
              isTiedForTop,
              rank,
              lift: row.lift,
              visitCount: row.visitCount,
              sharePercent: row.sharePercent,
            }),
            isTiedForTop,
            isClearTop,
            message: this.buildSuggestionMessage({
              campaignName: campaign.campaignName,
              addonName: row.addonName,
              timesPurchased: row.times,
              visitCount: row.visitCount,
              sharePercent: row.sharePercent,
              lift: row.lift,
              isClearTop,
              isTiedForTop,
              topStatus: topMeta.topStatus,
              rank,
            }),
          };
        });

        return {
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
          imageUrl: campaign.imageUrl,
          totalAddonPurchases,
          totalAddonVisits,
          topStatus: topMeta.topStatus,
          topAddonName: topMeta.topAddonName,
          totalSuggestions: allSuggestions.length,
          suggestions: allSuggestions,
        };
      },
    );

    return {
      businessId: params.businessId,
      from: params.from ? params.from.toISOString() : null,
      to: params.to ? params.to.toISOString() : null,
      campaigns: this.sortCampaignsByBest(campaignsFull),
    };
  }

  private async loadAggregatedCampaigns(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    campaignId?: number | null;
  }): Promise<AggregatedCampaign[]> {
    const qb = this.visitAddonItemRepository
      .createQueryBuilder('vai')
      .innerJoin(
        Campaign,
        'c',
        'c.id = vai.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
        { businessId: params.businessId },
      )
      .where('vai.business_id = :businessId', {
        businessId: params.businessId,
      })
      .andWhere('vai.campaign_id IS NOT NULL')
      .andWhere("TRIM(vai.name) <> ''")
      .select('vai.campaign_id', 'campaignId')
      .addSelect('c.campaign_name', 'campaignName')
      .addSelect('c.image_url', 'imageUrl')
      .addSelect('MAX(vai.name)', 'addonName')
      .addSelect('LOWER(TRIM(vai.name))', 'addonKey')
      .addSelect('SUM(vai.qty)', 'times')
      .addSelect('COUNT(DISTINCT vai.customer_visit_id)', 'visitCount')
      .addSelect('SUM(vai.line_total_cents)', 'revenueCents')
      .groupBy('vai.campaign_id')
      .addGroupBy('c.campaign_name')
      .addGroupBy('c.image_url')
      .addGroupBy('LOWER(TRIM(vai.name))')
      .orderBy('c.campaign_name', 'ASC')
      .addOrderBy('COUNT(DISTINCT vai.customer_visit_id)', 'DESC')
      .addOrderBy('SUM(vai.qty)', 'DESC')
      .addOrderBy('MAX(vai.name)', 'ASC');

    if (params.campaignId != null && params.campaignId > 0) {
      qb.andWhere('vai.campaign_id = :campaignId', {
        campaignId: params.campaignId,
      });
    }

    if (params.from) {
      qb.andWhere('vai.created_at >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('vai.created_at <= :to', { to: params.to });
    }

    const [rawRows, distinctVisitByCampaign] = await Promise.all([
      qb.getRawMany<{
        campaignId: string | number;
        campaignName: string;
        imageUrl: string | null;
        addonName: string;
        addonKey: string;
        times: string | number;
        visitCount: string | number;
        revenueCents: string | number;
      }>(),
      this.loadDistinctVisitCountsByCampaign(params),
    ]);

    const byCampaign = new Map<number, AggregatedCampaign>();

    for (const row of rawRows) {
      const campaignId = Number(row.campaignId);
      if (!Number.isFinite(campaignId) || campaignId <= 0) {
        continue;
      }

      const times = Math.round(Number(row.times));
      if (!Number.isFinite(times) || times <= 0) {
        continue;
      }

      const addonName = String(row.addonName ?? '').trim();
      if (!addonName) {
        continue;
      }

      const addonKey =
        String(row.addonKey ?? '').trim().toLowerCase() ||
        addonName.toLowerCase();
      const visitCount = Math.max(0, Math.round(Number(row.visitCount) || 0));
      const revenueCents = Math.max(
        0,
        Math.round(Number(row.revenueCents) || 0),
      );

      let campaign = byCampaign.get(campaignId);
      if (!campaign) {
        const imageUrlRaw = String(row.imageUrl ?? '').trim();
        campaign = {
          campaignId,
          campaignName:
            String(row.campaignName ?? '').trim() ||
            `Campaign #${campaignId}`,
          imageUrl: imageUrlRaw || null,
          distinctVisitCount: distinctVisitByCampaign.get(campaignId) ?? 0,
          rows: [],
        };
        byCampaign.set(campaignId, campaign);
      }

      campaign.rows.push({
        addonName,
        addonKey,
        times,
        visitCount,
        revenueCents,
      });
    }

    for (const campaign of byCampaign.values()) {
      campaign.rows = this.sortRowsByVolume(campaign.rows);
    }

    return Array.from(byCampaign.values());
  }

    private async loadDistinctVisitCountsByCampaign(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
    campaignId?: number | null;
  }): Promise<Map<number, number>> {
    const qb = this.visitAddonItemRepository
      .createQueryBuilder('vai')
      .innerJoin(
        Campaign,
        'c',
        'c.id = vai.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
        { businessId: params.businessId },
      )
      .where('vai.business_id = :businessId', {
        businessId: params.businessId,
      })
      .andWhere('vai.campaign_id IS NOT NULL')
      .andWhere("TRIM(vai.name) <> ''")
      .select('vai.campaign_id', 'campaignId')
      .addSelect('COUNT(DISTINCT vai.customer_visit_id)', 'visitCount')
      .groupBy('vai.campaign_id');

    if (params.campaignId != null && params.campaignId > 0) {
      qb.andWhere('vai.campaign_id = :campaignId', {
        campaignId: params.campaignId,
      });
    }
    if (params.from) {
      qb.andWhere('vai.created_at >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('vai.created_at <= :to', { to: params.to });
    }

    const rawRows = await qb.getRawMany<{
      campaignId: string | number;
      visitCount: string | number;
    }>();

    const map = new Map<number, number>();
    for (const row of rawRows) {
      const campaignId = Number(row.campaignId);
      const visitCount = Math.max(0, Math.round(Number(row.visitCount) || 0));
      if (Number.isFinite(campaignId) && campaignId > 0) {
        map.set(campaignId, visitCount);
      }
    }
    return map;
  }

  private async loadGlobalAddonStats(params: {
    businessId: number;
    from?: Date | null;
    to?: Date | null;
  }): Promise<GlobalAddonStats> {
    const qb = this.visitAddonItemRepository
      .createQueryBuilder('vai')
      .innerJoin(
        Campaign,
        'c',
        'c.id = vai.campaign_id AND c.business_id = :businessId AND c.deleted_at IS NULL',
        { businessId: params.businessId },
      )
      .where('vai.business_id = :businessId', {
        businessId: params.businessId,
      })
      .andWhere('vai.campaign_id IS NOT NULL')
      .andWhere("TRIM(vai.name) <> ''")
      .select('LOWER(TRIM(vai.name))', 'addonKey')
      .addSelect('SUM(vai.qty)', 'times')
      .groupBy('LOWER(TRIM(vai.name))');

    if (params.from) {
      qb.andWhere('vai.created_at >= :from', { from: params.from });
    }
    if (params.to) {
      qb.andWhere('vai.created_at <= :to', { to: params.to });
    }

    const rawRows = await qb.getRawMany<{
      addonKey: string;
      times: string | number;
    }>();

    const byKey = new Map<string, number>();
    let totalTimes = 0;

    for (const row of rawRows) {
      const key = String(row.addonKey ?? '').trim().toLowerCase();
      const times = Math.round(Number(row.times));
      if (!key || !Number.isFinite(times) || times <= 0) {
        continue;
      }
      byKey.set(key, times);
      totalTimes += times;
    }

    return { totalTimes, byKey };
  }

    private scoreRow(
    row: AggregatedRow,
    totalAddonPurchases: number,
    campaign: Pick<AggregatedCampaign, 'rows'>,
    globalStats: GlobalAddonStats,
    visitShareDenominator?: number,
  ): ScoredRow {
    const sharePercent =
      totalAddonPurchases > 0
        ? Math.round((row.times / totalAddonPurchases) * 1000) / 10
        : 0;

    const visitDenom =
      visitShareDenominator ??
      campaign.rows.reduce((sum, item) => sum + item.visitCount, 0);
    const visitSharePercent =
      visitDenom > 0
        ? Math.round((row.visitCount / visitDenom) * 1000) / 10
        : 0;

    const campaignShare =
      totalAddonPurchases > 0 ? row.times / totalAddonPurchases : 0;

    const globalTimesIncl = globalStats.byKey.get(row.addonKey) ?? 0;
    const globalTimesExcl = Math.max(0, globalTimesIncl - row.times);
    const totalTimesExcl = Math.max(
      0,
      globalStats.totalTimes - totalAddonPurchases,
    );

    let lift = 1;
    if (campaignShare <= 0) {
      lift = 1;
    } else if (totalTimesExcl <= 0 || globalTimesExcl <= 0) {
      lift = EXCLUSIVE_ADDON_LIFT;
    } else {
      const globalShareExcl = globalTimesExcl / totalTimesExcl;
      if (globalShareExcl > 0) {
        lift = Math.min(
          MAX_LIFT,
          Math.round((campaignShare / globalShareExcl) * 100) / 100,
        );
      } else {
        lift = EXCLUSIVE_ADDON_LIFT;
      }
    }

    const visitWeight = Math.log1p(row.visitCount);
    const volumeWeight = Math.log1p(row.times);
    const revenueWeight = Math.log1p(row.revenueCents / 100);
    const score =
      Math.round(
        (lift *
          (0.65 * visitWeight + 0.25 * volumeWeight + 0.1 * revenueWeight) +
          Number.EPSILON) *
          1000,
      ) / 1000;

    return {
      ...row,
      sharePercent,
      visitSharePercent,
      lift,
      score,
    };
  }

  private sortRowsByVolume(rows: AggregatedRow[]): AggregatedRow[] {
    return [...rows].sort((a, b) => {
      if (b.visitCount !== a.visitCount) {
        return b.visitCount - a.visitCount;
      }
      if (b.times !== a.times) {
        return b.times - a.times;
      }
      return a.addonName.localeCompare(b.addonName, undefined, {
        sensitivity: 'base',
      });
    });
  }

  private sortRowsByScore(rows: ScoredRow[]): ScoredRow[] {
    return [...rows].sort((a, b) => {
      if (Math.abs(b.score - a.score) > SCORE_TIE_EPSILON) {
        return b.score - a.score;
      }
      if (b.visitCount !== a.visitCount) {
        return b.visitCount - a.visitCount;
      }
      if (b.times !== a.times) {
        return b.times - a.times;
      }
      return a.addonName.localeCompare(b.addonName, undefined, {
        sensitivity: 'base',
      });
    });
  }

  private sortCampaignsByBest<
    T extends {
      campaignName: string;
      totalAddonPurchases: number;
      topStatus: CampaignAddonTopStatus;
      addons?: Array<{ times: number; visitCount?: number }>;
      suggestions?: Array<{
        timesPurchased: number;
        visitCount?: number;
        score?: number;
      }>;
    },
  >(campaigns: T[]): T[] {
    const statusRank = (status: CampaignAddonTopStatus) =>
      status === 'clear' ? 0 : status === 'tied' ? 1 : 2;

    const topStrength = (campaign: T) => {
      const suggestion = campaign.suggestions?.[0];
      if (suggestion?.score != null) return suggestion.score;
      if (suggestion?.visitCount != null) return suggestion.visitCount;
      const addon = campaign.addons?.[0];
      if (addon?.visitCount != null) return addon.visitCount;
      return (
        campaign.addons?.[0]?.times ??
        campaign.suggestions?.[0]?.timesPurchased ??
        0
      );
    };

    return [...campaigns].sort((a, b) => {
      const byStatus = statusRank(a.topStatus) - statusRank(b.topStatus);
      if (byStatus !== 0) return byStatus;

      const byTop = topStrength(b) - topStrength(a);
      if (byTop !== 0) return byTop;

      if (b.totalAddonPurchases !== a.totalAddonPurchases) {
        return b.totalAddonPurchases - a.totalAddonPurchases;
      }

      return a.campaignName.localeCompare(b.campaignName, undefined, {
        sensitivity: 'base',
      });
    });
  }

  private resolveTopMetaFromScored(
    sortedRows: ScoredRow[],
  ): { topStatus: CampaignAddonTopStatus; topAddonName: string | null } {
    if (sortedRows.length === 0) {
      return { topStatus: 'emerging', topAddonName: null };
    }

    const top = sortedRows[0];
    const tiedForFirst = sortedRows.filter(
      (row) => Math.abs(row.score - top.score) <= SCORE_TIE_EPSILON,
    );
    if (tiedForFirst.length > 1) {
      return { topStatus: 'tied', topAddonName: null };
    }

    if (
      top.visitCount < MIN_CLEAR_TOP_VISITS ||
      top.lift < MIN_LIFT_FOR_STRONG
    ) {
      return {
        topStatus: 'emerging',
        topAddonName: top.addonName,
      };
    }

    return {
      topStatus: 'clear',
      topAddonName: top.addonName,
    };
  }

  private resolvePriority(params: {
    isClearTop: boolean;
    isTiedForTop: boolean;
    rank: number;
    lift: number;
    visitCount: number;
    sharePercent: number;
  }): 'high' | 'medium' | 'low' {
    if (
      params.isClearTop ||
      (params.lift >= MIN_LIFT_FOR_STRONG &&
        params.visitCount >= MIN_CLEAR_TOP_VISITS)
    ) {
      return 'high';
    }
    if (
      params.isTiedForTop ||
      params.rank <= 3 ||
      params.sharePercent >= 15 ||
      params.lift >= 1.1
    ) {
      return 'medium';
    }
    return 'low';
  }

  private buildSuggestionMessage(params: {
    campaignName: string;
    addonName: string;
    timesPurchased: number;
    visitCount: number;
    sharePercent: number;
    lift: number;
    isClearTop: boolean;
    isTiedForTop: boolean;
    topStatus: CampaignAddonTopStatus;
    rank: number;
  }): string {
    const visitLabel = `${params.visitCount} visit${params.visitCount === 1 ? '' : 's'}`;
    const shareLabel = `${params.sharePercent}% of add-ons with this deal`;

    if (params.isClearTop) {
      return `Best match: offer ${params.addonName} with ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}).`;
    }

    if (params.isTiedForTop) {
      return `${params.addonName} is tied with other top add-ons for ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}). More data needed for a clear winner.`;
    }

    if (params.topStatus === 'emerging' && params.rank === 1) {
      return `Early lead: ${params.addonName} with ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}). Check again as more orders come in.`;
    }

    if (params.lift >= MIN_LIFT_FOR_STRONG) {
      return `Good pairing: ${params.addonName} with ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}). Stronger with this deal than usual.`;
    }

    if (params.lift >= 1.1) {
      return `Worth trying: ${params.addonName} with ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}). Slightly stronger with this deal.`;
    }

    return `Also consider ${params.addonName} with ${params.campaignName}. Seen in ${visitLabel} (${shareLabel}).`;
  }
}
