import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BusinessUserSidebarSectionReadState,
  type SidebarUnreadSection,
} from '../../db/entities/business-user-sidebar-section-read-state.entity';
import { Order } from '../../db/entities/order.entity';
import { ActivityEvent, ActivityEventType } from '../../db/entities/activity-event.entity';
import { BusinessHistory } from '../../db/entities/business-history.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import {
  BusinessAccessService,
  type BusinessAccessUser,
} from '../business-access/business-access.service';
import { hasAnyCampaignPermission } from '../member/member.constants';
import { isAdminOrSuperAdmin } from '../../utils/user-roles';

export type SidebarSectionUnreadDto = {
  hasUnread: boolean;
  unreadCount: number;
  lastViewedAt: string | null;
  latestAt: string | null;
  latestDescription: string | null;
};

export type LatestGuestJoinedDto = {
  customerId: number;
  guestName: string;
  guestEmail: string | null;
  campaignName: string | null;
  occurredAt: string;
};

export type LatestAccessUpdatedDto = {
  businessName: string;
  previousRole: string;
  role: string;
  grantedPermissions: string[];
  removedPermissions: string[];
  updatedAt: string;
};

export type BusinessSidebarUnreadDto = {
  orders: SidebarSectionUnreadDto;
  activity: SidebarSectionUnreadDto;
  history: SidebarSectionUnreadDto;
  latestGuestJoined: LatestGuestJoinedDto | null;
  latestAccessUpdated: LatestAccessUpdatedDto | null;
};

const EMPTY_SECTION: SidebarSectionUnreadDto = {
  hasUnread: false,
  unreadCount: 0,
  lastViewedAt: null,
  latestAt: null,
  latestDescription: null,
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
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
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
    if (section === 'history') {
      await this.businessAccessService.assertAnyPermission(user, businessId, [
        'history',
      ]);
      return;
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
    user: BusinessAccessUser,
    allowedSections: SidebarUnreadSection[],
  ): Promise<BusinessSidebarUnreadDto> {
    const allowed = new Set(allowedSections);
    const context = await this.businessAccessService.getAccessContext(
      user,
      businessId,
    );
    const canGuestNotify =
      context?.access === 'owner' ||
      context?.access === 'super_admin' ||
      hasAnyCampaignPermission(context?.permissions ?? []);

    const [orders, activity, history, latestGuestJoined, latestAccessUpdated] =
      await Promise.all([
        allowed.has('orders')
          ? this.resolveSectionUnread(businessId, user.id, 'orders')
          : Promise.resolve({ ...EMPTY_SECTION }),
        allowed.has('activity')
          ? this.resolveSectionUnread(businessId, user.id, 'activity')
          : Promise.resolve({ ...EMPTY_SECTION }),
        allowed.has('history')
          ? this.resolveSectionUnread(businessId, user.id, 'history')
          : Promise.resolve({ ...EMPTY_SECTION }),
        canGuestNotify
          ? this.resolveLatestGuestJoined(businessId, user.id)
          : Promise.resolve(null),
        this.resolveLatestAccessUpdated(businessId, user.id),
      ]);

    return {
      orders,
      activity,
      history,
      latestGuestJoined,
      latestAccessUpdated,
    };
  }

  async markAccessNotifyRead(
    businessId: number,
    userId: number,
  ): Promise<void> {
    await this.businessMemberRepository
      .createQueryBuilder()
      .update(BusinessMember)
      .set({
        accessNotifyAt: null,
        accessNotifyPayload: null,
      })
      .where('business_id = :businessId', { businessId })
      .andWhere('user_id = :userId', { userId })
      .execute();
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
        latestDescription: null,
      };
    }

    const viewedAt = readState.lastViewedAt;
    const unreadCount = await this.countUnreadSince(
      businessId,
      userId,
      section,
      viewedAt,
    );

    const latestDescription =
      unreadCount > 0 && section === 'history'
        ? await this.getLatestUnreadHistoryDescription(
            businessId,
            userId,
            viewedAt,
          )
        : null;

    return {
      hasUnread: unreadCount > 0,
      unreadCount,
      lastViewedAt: viewedAt.toISOString(),
      latestAt:
        unreadCount > 0 && latest ? latest.toISOString() : null,
      latestDescription,
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

  private async resolveLatestGuestJoined(
    businessId: number,
    userId: number,
  ): Promise<LatestGuestJoinedDto | null> {
    const since = await this.getGuestJoinedSince(businessId, userId);
    return this.getLatestUnreadGuestJoined(businessId, userId, since);
  }

  private async getGuestJoinedSince(
    businessId: number,
    userId: number,
  ): Promise<Date> {
    const readState = await this.readStateRepository.findOne({
      where: { businessId, userId, section: 'activity' },
    });
    if (readState?.lastViewedAt) {
      return readState.lastViewedAt;
    }
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  private async resolveLatestAccessUpdated(
    businessId: number,
    userId: number,
  ): Promise<LatestAccessUpdatedDto | null> {
    const member = await this.businessMemberRepository
      .createQueryBuilder('member')
      .where('member.business_id = :businessId', { businessId })
      .andWhere('member.user_id = :userId', { userId })
      .getOne();

    if (!member?.accessNotifyAt || !member.accessNotifyPayload) {
      return null;
    }

    const payload = member.accessNotifyPayload;
    return {
      businessName:
        typeof payload.businessName === 'string' && payload.businessName.trim()
          ? payload.businessName.trim()
          : 'Business',
      previousRole:
        typeof payload.previousRole === 'string'
          ? payload.previousRole
          : '',
      role: typeof payload.role === 'string' ? payload.role : '',
      grantedPermissions: Array.isArray(payload.grantedPermissions)
        ? payload.grantedPermissions.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      removedPermissions: Array.isArray(payload.removedPermissions)
        ? payload.removedPermissions.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
      updatedAt: member.accessNotifyAt.toISOString(),
    };
  }

  private async getLatestUnreadHistoryDescription(
    businessId: number,
    userId: number,
    since: Date,
  ): Promise<string | null> {
    const row = await this.historyRepository
      .createQueryBuilder('history')
      .select('history.description', 'description')
      .where('history.businessId = :businessId', { businessId })
      .andWhere('history.occurredAt > :since', { since })
      .andWhere(
        '(history.actorUserId IS NULL OR history.actorUserId IS DISTINCT FROM :userId)',
        { userId },
      )
      .orderBy('history.occurredAt', 'DESC')
      .addOrderBy('history.id', 'DESC')
      .limit(1)
      .getRawOne<{ description: string | null }>();

    const description =
      typeof row?.description === 'string' ? row.description.trim() : '';
    return description || null;
  }

  private async getLatestUnreadGuestJoined(
    businessId: number,
    userId: number,
    since: Date,
  ): Promise<LatestGuestJoinedDto | null> {
    const row = await this.activityRepository
      .createQueryBuilder('activity')
      .leftJoinAndSelect('activity.customer', 'customer')
      .where('activity.businessId = :businessId', { businessId })
      .andWhere('activity.occurredAt > :since', { since })
      .andWhere('activity.eventType = :eventType', {
        eventType: ActivityEventType.SIGNED_UP,
      })
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
      .orderBy('activity.occurredAt', 'DESC')
      .addOrderBy('activity.id', 'DESC')
      .getOne();

    if (!row?.customerId || !row.occurredAt) {
      return null;
    }

    const metadata =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : null;
    const campaignNameRaw = metadata?.campaignName;
    const campaignName =
      typeof campaignNameRaw === 'string' && campaignNameRaw.trim()
        ? campaignNameRaw.trim()
        : null;
    const guestName =
      row.customer?.name?.trim() ||
      row.customer?.email?.trim() ||
      'A guest';
    const guestEmail = row.customer?.email?.trim() || null;

    return {
      customerId: row.customerId,
      guestName,
      guestEmail,
      campaignName,
      occurredAt:
        row.occurredAt instanceof Date
          ? row.occurredAt.toISOString()
          : new Date(row.occurredAt).toISOString(),
    };
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
