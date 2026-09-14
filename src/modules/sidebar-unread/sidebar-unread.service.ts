import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BusinessUserSidebarSectionReadState,
  type SidebarUnreadSection,
} from '../../db/entities/business-user-sidebar-section-read-state.entity';
import { Order } from '../../db/entities/order.entity';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { BusinessHistory } from '../../db/entities/business-history.entity';
import {
  BusinessAccessService,
  type BusinessAccessUser,
} from '../business-access/business-access.service';
import { isAdminOrSuperAdmin } from '../../utils/user-roles';
import { SIDEBAR_UNREAD_SECTIONS } from './sidebar-unread.constants';

export type SidebarSectionUnreadDto = {
  hasUnread: boolean;
  unreadCount: number;
  lastViewedAt: string | null;
  latestAt: string | null;
};

export type BusinessSidebarUnreadDto = {
  orders: SidebarSectionUnreadDto;
  activity: SidebarSectionUnreadDto;
  history: SidebarSectionUnreadDto;
};

const EMPTY_SECTION: SidebarSectionUnreadDto = {
  hasUnread: false,
  unreadCount: 0,
  lastViewedAt: null,
  latestAt: null,
};

@Injectable()
export class SidebarUnreadService {
  constructor(
    @InjectRepository(BusinessUserSidebarSectionReadState)
    private readonly readStateRepository: Repository<BusinessUserSidebarSectionReadState>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(ActivityEvent)
    private readonly activityRepository: Repository<ActivityEvent>,
    @InjectRepository(BusinessHistory)
    private readonly historyRepository: Repository<BusinessHistory>,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  async assertCanAccessSection(
    user: BusinessAccessUser,
    businessId: number,
    section: SidebarUnreadSection,
  ): Promise<void> {
    if (section === 'orders') {
      await this.businessAccessService.assertAnyPermission(user, businessId, [
        'orders',
      ]);
      return;
    }
    if (section === 'activity') {
      await this.businessAccessService.assertAnyPermission(user, businessId, [
        'activity',
      ]);
      return;
    }
    const context = await this.businessAccessService.getAccessContext(
      user,
      businessId,
    );
    if (context) {
      return;
    }
    if (isAdminOrSuperAdmin(user)) {
      const business = await this.businessAccessService.findAccessibleBusiness(
        user,
        businessId,
      );
      if (business) {
        return;
      }
    }
    throw new ForbiddenException(
      'Business not found or you do not have access to this business.',
    );
  }

  async assertBusinessAccess(
    user: BusinessAccessUser,
    businessId: number,
  ): Promise<void> {
    const context = await this.businessAccessService.getAccessContext(
      user,
      businessId,
    );
    if (!context) {
      throw new ForbiddenException(
        'Business not found or you do not have access to this business.',
      );
    }
  }

  async markSectionRead(
    businessId: number,
    userId: number,
    section: SidebarUnreadSection,
  ): Promise<Date> {
    const latest = await this.getLatestSectionAt(businessId, section);
    const viewedAt =
      latest && latest.getTime() > Date.now() ? latest : new Date();

    await this.readStateRepository.upsert(
      {
        businessId,
        userId,
        section,
        lastViewedAt: viewedAt,
      },
      {
        conflictPaths: ['userId', 'businessId', 'section'],
        skipUpdateIfNoValuesChanged: false,
      },
    );

    return viewedAt;
  }

  async getSectionUnread(
    businessId: number,
    userId: number,
    section: SidebarUnreadSection,
  ): Promise<SidebarSectionUnreadDto> {
    return this.resolveSectionUnread(businessId, userId, section);
  }

  async getBusinessUnread(
    businessId: number,
    userId: number,
    allowedSections: SidebarUnreadSection[],
  ): Promise<BusinessSidebarUnreadDto> {
    const allowed = new Set(allowedSections);
    const [orders, activity, history] = await Promise.all(
      SIDEBAR_UNREAD_SECTIONS.map(async (section) => {
        if (!allowed.has(section)) {
          return { ...EMPTY_SECTION };
        }
        return this.resolveSectionUnread(businessId, userId, section);
      }),
    );

    return { orders, activity, history };
  }

  private async resolveSectionUnread(
    businessId: number,
    userId: number,
    section: SidebarUnreadSection,
  ): Promise<SidebarSectionUnreadDto> {
    const latest = await this.getLatestSectionAt(businessId, section);
    const readState = await this.readStateRepository.findOne({
      where: { businessId, userId, section },
    });

    if (!readState) {
      const baseline = latest ?? new Date();
      await this.readStateRepository.upsert(
        {
          businessId,
          userId,
          section,
          lastViewedAt: baseline,
        },
        {
          conflictPaths: ['userId', 'businessId', 'section'],
          skipUpdateIfNoValuesChanged: false,
        },
      );
      return {
        hasUnread: false,
        unreadCount: 0,
        lastViewedAt: baseline.toISOString(),
        latestAt: null,
      };
    }

    const viewedAt = readState.lastViewedAt;
    const unreadCount = await this.countUnreadSince(
      businessId,
      userId,
      section,
      viewedAt,
    );

    return {
      hasUnread: unreadCount > 0,
      unreadCount,
      lastViewedAt: viewedAt.toISOString(),
      latestAt:
        unreadCount > 0 && latest ? latest.toISOString() : null,
    };
  }

  private async countUnreadSince(
    businessId: number,
    userId: number,
    section: SidebarUnreadSection,
    since: Date,
  ): Promise<number> {
    if (section === 'orders') {
      return this.countUnreadOrders(businessId, userId, since);
    }
    if (section === 'activity') {
      return this.countUnreadActivity(businessId, userId, since);
    }
    return this.countUnreadHistory(businessId, userId, since);
  }

    private ordersListSortSql(): string {
    return `COALESCE(
      ord.paid_at,
      (
        SELECT MAX(v.visit_date)
        FROM customer_visits v
        WHERE v.order_id = ord.id
          AND v.deleted_at IS NULL
      ),
      ord.created_at
    )`;
  }

  private async getLatestSectionAt(
    businessId: number,
    section: SidebarUnreadSection,
  ): Promise<Date | null> {
    if (section === 'orders') {
      return this.getLatestOrdersAt(businessId);
    }
    if (section === 'activity') {
      return this.getLatestActivityAt(businessId);
    }
    return this.getLatestHistoryAt(businessId);
  }

  private async getLatestOrdersAt(businessId: number): Promise<Date | null> {
    const row = await this.orderRepository
      .createQueryBuilder('ord')
      .select(this.ordersListSortSql(), 'latestAt')
      .where('ord.business_id = :businessId', { businessId })
      .andWhere('ord.deleted_at IS NULL')
      .orderBy(this.ordersListSortSql(), 'DESC')
      .addOrderBy('ord.id', 'DESC')
      .limit(1)
      .getRawOne<{ latestAt: Date | string | null }>();

    return this.toDate(row?.latestAt);
  }

  private async getLatestActivityAt(businessId: number): Promise<Date | null> {
    const row = await this.activityRepository.findOne({
      where: { businessId },
      order: { occurredAt: 'DESC', id: 'DESC' },
      select: ['occurredAt'],
    });
    return row?.occurredAt ?? null;
  }

  private async getLatestHistoryAt(businessId: number): Promise<Date | null> {
    const row = await this.historyRepository.findOne({
      where: { businessId },
      order: { occurredAt: 'DESC', id: 'DESC' },
      select: ['occurredAt'],
    });
    return row?.occurredAt ?? null;
  }

  private async countUnreadOrders(
    businessId: number,
    userId: number,
    since: Date,
  ): Promise<number> {
    return this.orderRepository
      .createQueryBuilder('ord')
      .where('ord.business_id = :businessId', { businessId })
      .andWhere('ord.deleted_at IS NULL')
      .andWhere(`${this.ordersListSortSql()} > :since`, { since })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM funnel_payment p
          WHERE p.order_id = ord.id
            AND p.deleted_at IS NULL
            AND p.payment_collected_by = :userId
        )`,
        { userId },
      )
      .getCount();
  }

  private async countUnreadActivity(
    businessId: number,
    userId: number,
    since: Date,
  ): Promise<number> {
    return this.activityRepository
      .createQueryBuilder('activity')
      .where('activity.businessId = :businessId', { businessId })
      .andWhere('activity.occurredAt > :since', { since })
      .andWhere(
        `(
          activity.metadata IS NULL
          OR (
            COALESCE(
              NULLIF(activity.metadata->>'actorUserId', ''),
              NULLIF(activity.metadata->>'staffUserId', ''),
              NULLIF(activity.metadata->>'paymentCollectedBy', '')
            ) IS NULL
            OR COALESCE(
              NULLIF(activity.metadata->>'actorUserId', ''),
              NULLIF(activity.metadata->>'staffUserId', ''),
              NULLIF(activity.metadata->>'paymentCollectedBy', '')
            )::int IS DISTINCT FROM :userId
          )
        )`,
        { userId },
      )
      .getCount();
  }

  private async countUnreadHistory(
    businessId: number,
    userId: number,
    since: Date,
  ): Promise<number> {
    return this.historyRepository
      .createQueryBuilder('history')
      .where('history.businessId = :businessId', { businessId })
      .andWhere('history.occurredAt > :since', { since })
      .andWhere(
        '(history.actorUserId IS NULL OR history.actorUserId IS DISTINCT FROM :userId)',
        { userId },
      )
      .getCount();
  }

  private toDate(value: Date | string | null | undefined): Date | null {
    if (value == null) return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value : null;
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
}
