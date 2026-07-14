import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FunnelAnalyticsEvent,
  FunnelAnalyticsEventType,
} from '../../db/entities/funnel-analytics-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Customer } from '../../db/entities/customer.entity';
import { TrackFunnelAnalyticsDto } from './funnelEventDto/track-funnel-analytics.dto';
import {
  buildRecentMonthBuckets,
} from './overview-monthly.util';
import { And, LessThan, MoreThanOrEqual } from 'typeorm';

export type FunnelAnalyticsOverview = {
  funnelId: number;
  pageViews: number;
  buttonClicks: number;
  uniqueVisitors: number;
  checkoutOpens: number;
};

export type FunnelDropoffStep = {
  stepName: string;
  stepOrder: number;
  count: number;
};

export type FunnelTrafficSource = {
  utmSource: string | null;
  utmCampaign: string | null;
  count: number;
};

@Injectable()
export class FunnelAnalyticsService {
  constructor(
    @InjectRepository(FunnelAnalyticsEvent)
    private readonly analyticsRepository: Repository<FunnelAnalyticsEvent>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  async trackAnalyticsEvent(
    dto: TrackFunnelAnalyticsDto,
  ): Promise<FunnelAnalyticsEvent> {
    await this.assertFunnelExists(dto.funnelId);

    if (dto.customerId != null) {
      const customerExists = await this.customerRepository.exist({
        where: { id: dto.customerId },
      });
      if (!customerExists) {
        throw new NotFoundException('Customer not found.');
      }
    }

    const visitorId = this.normalizeOptionalString(dto.visitorId);
    const sessionId = this.normalizeOptionalString(dto.sessionId);

    if (dto.customerId != null && visitorId) {
      await this.linkAnonymousEventsToCustomer(
        dto.funnelId,
        visitorId,
        sessionId,
        dto.customerId,
      );
    }

    const record = this.analyticsRepository.create({
      funnelId: dto.funnelId,
      eventType: dto.eventType,
      visitorId,
      customerId: dto.customerId ?? null,
      sessionId,
      pagePath: this.normalizeOptionalString(dto.pagePath),
      stepName: this.normalizeOptionalString(dto.stepName),
      stepOrder: dto.stepOrder ?? null,
      utmSource: this.normalizeOptionalString(dto.utmSource),
      utmMedium: this.normalizeOptionalString(dto.utmMedium),
      utmCampaign: this.normalizeOptionalString(dto.utmCampaign),
      referrer: this.normalizeOptionalString(dto.referrer),
      metadata: dto.metadata ?? null,
    });

    return this.analyticsRepository.save(record);
  }

  async getAnalyticsOverview(funnelId: number): Promise<FunnelAnalyticsOverview> {
    await this.assertFunnelExists(funnelId);

    const pageViews = await this.analyticsRepository.count({
      where: { funnelId, eventType: FunnelAnalyticsEventType.PAGE_VIEW },
    });

    const buttonClicks = await this.analyticsRepository.count({
      where: { funnelId, eventType: FunnelAnalyticsEventType.BUTTON_CLICK },
    });

    const uniqueVisitorsRaw = await this.analyticsRepository
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.customer_id)', 'count')
      .where('e.funnel_id = :funnelId', { funnelId })
      .andWhere('e.customer_id IS NOT NULL')
      .getRawOne<{ count: string }>();

    // Change: checkout opens replace sessions — clearer for campaign owners.
    const checkoutOpens = await this.analyticsRepository.count({
      where: { funnelId, eventType: FunnelAnalyticsEventType.CHECKOUT_OPEN },
    });

    return {
      funnelId,
      pageViews,
      buttonClicks,
      uniqueVisitors: Number(uniqueVisitorsRaw?.count ?? 0),
      checkoutOpens,
    };
  }

  async getAnalyticsOverviewMonthly(
    funnelId: number,
    monthCount: number,
  ): Promise<{
    funnelId: number;
    months: number;
    data: {
      month: string;
      pageViews: number;
      buttonClicks: number;
      uniqueVisitors: number;
      checkoutOpens: number;
    }[];
  }> {
    await this.assertFunnelExists(funnelId);

    const buckets = buildRecentMonthBuckets(monthCount);
    if (buckets.length === 0) {
      return { funnelId, months: monthCount, data: [] };
    }

    const rangeStart = buckets[0]!.start;
    const rows = await this.analyticsRepository
      .createQueryBuilder('e')
      .select(
        `TO_CHAR(DATE_TRUNC('month', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM')`,
        'month',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.event_type = :pageView)`,
        'pageViews',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.event_type = :buttonClick)`,
        'buttonClicks',
      )
      .addSelect(`COUNT(DISTINCT e.customer_id)`, 'uniqueVisitors')
      .addSelect(
        `COUNT(*) FILTER (WHERE e.event_type = :checkoutOpen)`,
        'checkoutOpens',
      )
      .where('e.funnel_id = :funnelId', { funnelId })
      .andWhere('e.created_at >= :rangeStart', { rangeStart })
      .setParameters({
        pageView: FunnelAnalyticsEventType.PAGE_VIEW,
        buttonClick: FunnelAnalyticsEventType.BUTTON_CLICK,
        checkoutOpen: FunnelAnalyticsEventType.CHECKOUT_OPEN,
      })
      .groupBy(`DATE_TRUNC('month', e.created_at AT TIME ZONE 'UTC')`)
      .getRawMany<{
        month: string;
        pageViews: string;
        buttonClicks: string;
        uniqueVisitors: string;
        checkoutOpens: string;
      }>();

    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const data = buckets.map((bucket) => {
      const row = byMonth.get(bucket.month);
      return {
        month: bucket.month,
        pageViews: Number(row?.pageViews ?? 0),
        buttonClicks: Number(row?.buttonClicks ?? 0),
        uniqueVisitors: Number(row?.uniqueVisitors ?? 0),
        checkoutOpens: Number(row?.checkoutOpens ?? 0),
      };
    });

    return { funnelId, months: monthCount, data };
  }

  async getFunnelDropoff(funnelId: number): Promise<FunnelDropoffStep[]> {
    await this.assertFunnelExists(funnelId);

    const rows = await this.analyticsRepository
      .createQueryBuilder('e')
      .select('e.step_name', 'stepName')
      .addSelect('e.step_order', 'stepOrder')
      .addSelect('COUNT(*)', 'count')
      .where('e.funnel_id = :funnelId', { funnelId })
      .andWhere('e.event_type = :eventType', {
        eventType: FunnelAnalyticsEventType.PAGE_VIEW,
      })
      .andWhere('e.step_name IS NOT NULL')
      .groupBy('e.step_name')
      .addGroupBy('e.step_order')
      .orderBy('e.step_order', 'ASC', 'NULLS LAST')
      .addOrderBy('e.step_name', 'ASC')
      .getRawMany<{ stepName: string; stepOrder: string; count: string }>();

    return rows.map((row) => ({
      stepName: row.stepName,
      stepOrder: Number(row.stepOrder ?? 0),
      count: Number(row.count),
    }));
  }

  async getTrafficSources(funnelId: number): Promise<FunnelTrafficSource[]> {
    await this.assertFunnelExists(funnelId);

    const rows = await this.analyticsRepository
      .createQueryBuilder('e')
      .select('e.utm_source', 'utmSource')
      .addSelect('e.utm_campaign', 'utmCampaign')
      .addSelect('COUNT(*)', 'count')
      .where('e.funnel_id = :funnelId', { funnelId })
      .andWhere('(e.utm_source IS NOT NULL OR e.utm_campaign IS NOT NULL)')
      .groupBy('e.utm_source')
      .addGroupBy('e.utm_campaign')
      .orderBy('count', 'DESC')
      .getRawMany<{
        utmSource: string | null;
        utmCampaign: string | null;
        count: string;
      }>();

    return rows.map((row) => ({
      utmSource: row.utmSource,
      utmCampaign: row.utmCampaign,
      count: Number(row.count),
    }));
  }

  private async assertFunnelExists(funnelId: number): Promise<void> {
    const exists = await this.funnelRepository.exist({ where: { id: funnelId } });
    if (!exists) {
      throw new NotFoundException('Funnel not found');
    }
  }

  private async linkAnonymousEventsToCustomer(
    funnelId: number,
    visitorId: string,
    sessionId: string | null,
    customerId: number,
  ): Promise<void> {
    const qb = this.analyticsRepository
      .createQueryBuilder()
      .update(FunnelAnalyticsEvent)
      .set({ customerId })
      .where('funnel_id = :funnelId', { funnelId })
      .andWhere('visitor_id = :visitorId', { visitorId })
      .andWhere('customer_id IS NULL');

    if (sessionId) {
      qb.andWhere('session_id = :sessionId', { sessionId });
    }

    await qb.execute();
  }

  private normalizeOptionalString(value?: string): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }
}
