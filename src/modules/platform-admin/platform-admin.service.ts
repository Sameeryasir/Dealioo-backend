import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { CUSTOMER_ONBOARDING_STATUS } from '../customer-onboarding/customer-onboarding.constants';
import { BUSINESS_MEMBER_STATUS } from '../member/business-member-status';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../member/member.constants';
import * as bcrypt from 'bcrypt';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../../utils/business-slug';
import {
  ADMIN_ROLE,
  isSuperAdmin,
  isSuperAdminRole,
  PLATFORM_ROLES,
  SUPER_ADMIN_ROLE,
} from '../../utils/user-roles';
import { computeBusinessSetupProgressFromEntity } from '../business/business-setup-progress';
import { PlatformAdminAuditLog } from '../../db/entities/platform-admin-audit-log.entity';
import { JwtStrategy } from '../auth/jwt/jwt.strategy';
import { CreateAdminBusinessDto } from './dto/create-admin-business.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

export type AdminUsersTab =
  | 'all'
  | 'active'
  | 'inactive'
  | 'admins'
  | 'managers'
  | 'viewers';

export type AdminUsersSort = 'newest' | 'oldest' | 'name_asc' | 'name_desc';

export type AdminUsersSummary = {
  total: number;
  newUsers: number;
  active: number;
  inactive: number;
  totalChangePct: number;
  newUsersChangePct: number;
  activeSharePct: number;
  inactiveSharePct: number;
  tabs: {
    all: number;
    active: number;
    inactive: number;
    admins: number;
    managers: number;
    viewers: number;
  };
};
import {
  addMinutes,
  zonedDateTime,
} from '../google-calendar/google-calendar.util';
import {
  buildZonedRangeBucketKeys,
  overviewRangeBucketSql,
  resolveSafeTimeZone,
} from '../funnel-event/overview-monthly.util';
import { buildRegionBreakdownFromCountryCounts } from './platform-admin-regions';

export type PlatformDashboardPeriod = 'today' | 'week' | 'month' | 'year';

export type PlatformDashboardKpi = {
  value: number;
  changePct: number;
  sparkline: number[];
  hint: string;
};

export type PlatformDashboardPanel = {
  period: PlatformDashboardPeriod;
  label: string;
  from: string;
  to: string;
  kpis: {
    mrr: PlatformDashboardKpi;
    planEarnings: PlatformDashboardKpi;
    platformUsers: PlatformDashboardKpi;
    payingSubscriptions: PlatformDashboardKpi;
    newPlans: PlatformDashboardKpi;
  };
  charts: {
    planEarnings: Array<{ label: string; value: number }>;
    subscriptions: Array<{ label: string; value: number }>;
    users: Array<{ label: string; value: number }>;
    businesses: Array<{ label: string; value: number }>;
  };
  regions: Array<{ region: string; count: number; sharePct: number }>;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type PlatformAdminOverview = {
  kpis: {
    totalBusinesses: number;
    activeBusinesses: number;
    totalUsers: number;
    newUsersToday: number;
    ordersToday: number;
    revenueTodayCents: number;
    businessesChangePct: number;
    activeBusinessesChangePct: number;
    usersChangePct: number;
    newUsersChangePct: number;
    ordersChangePct: number;
    revenueChangePct: number;
  };
  charts: {
    revenueLast30Days: Array<{ date: string; amountCents: number }>;
    businessesLast30Days: Array<{ date: string; count: number }>;
    subscriptionBreakdown: Array<{
      planSlug: string;
      planName: string;
      count: number;
      mrrCents: number;
    }>;
  };
  businesses: Array<{
    id: number;
    name: string;
    slug: string;
    logoUrl: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    email: string | null;
    phoneNumber: string | null;
    onboardingCompleted: boolean;
    stripeConnected: boolean;
    metaConnected: boolean;
    googleAdsConnected: boolean;
    twilioConnected: boolean;
    setupProgressPercent: number;
    setupComplete: boolean;
    createdAt: Date;
    ownerName: string | null;
    ownerEmail: string | null;
    ownerAvatar: string | null;
    planName: string | null;
    planSlug: string | null;
  }>;
  users: Array<{
    id: number;
    name: string;
    email: string;
    phone: string | null;
    avatar: string | null;
    roleName: string | null;
    isActive: boolean;
    emailVerified: boolean;
    provider: string;
    createdAt: Date;
    lastLoginAt: Date | null;
    planName: string | null;
    planSlug: string | null;
    businesses: Array<{
      id: number;
      name: string;
      role: string;
      logoUrl: string | null;
    }>;
  }>;
};

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(AdminNotification)
    private readonly adminNotificationRepository: Repository<AdminNotification>,
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepository: Repository<MeetingRequest>,
    @InjectRepository(CustomerOnboarding)
    private readonly customerOnboardingRepository: Repository<CustomerOnboarding>,
    @InjectRepository(PlatformAdminAuditLog)
    private readonly auditLogRepository: Repository<PlatformAdminAuditLog>,
    private readonly jwtStrategy: JwtStrategy,
  ) {}

  private assertSuperAdmin(user: User): void {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only Super Admin can access the platform overview.',
      );
    }
  }

  private async writeAudit(input: {
    actorUserId: number;
    action: string;
    targetType: string;
    targetId?: string | number | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUserId: input.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId:
            input.targetId == null ? null : String(input.targetId),
          metadata: input.metadata ?? null,
        }),
      );
    } catch {
      return;
    }
  }

  private toAdminUserItem(
    user: User,
    plan: { planName: string; planSlug: string } | null = null,
    businesses: PlatformAdminOverview['users'][number]['businesses'] = [],
  ): PlatformAdminOverview['users'][number] {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar ?? null,
      roleName: user.role?.name ?? null,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      provider: user.provider,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      planName: plan?.planName ?? null,
      planSlug: plan?.planSlug ?? null,
      businesses,
    };
  }

  private async loadBusinessMapForUserIds(
    userIds: number[],
  ): Promise<Map<number, PlatformAdminOverview['users'][number]['businesses']>> {
    const map = new Map<
      number,
      PlatformAdminOverview['users'][number]['businesses']
    >();
    if (userIds.length === 0) return map;

    const memberships = await this.businessMemberRepository
      .createQueryBuilder('bm')
      .innerJoinAndSelect('bm.business', 'business')
      .innerJoinAndSelect('bm.user', 'memberUser')
      .where('memberUser.id IN (:...userIds)', { userIds })
      .andWhere('bm.status = :status', {
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
      })
      .orderBy('business.name', 'ASC')
      .getMany();

    for (const membership of memberships) {
      const memberUserId = membership.user?.id;
      const business = membership.business;
      if (!memberUserId || !business) continue;
      const list = map.get(memberUserId) ?? [];
      list.push({
        id: business.id,
        name: business.name,
        role: membership.role,
        logoUrl: business.logoUrl ?? null,
      });
      map.set(memberUserId, list);
    }

    return map;
  }

  private readonly usersWithBusinessRolesSql = `EXISTS (
    SELECT 1
    FROM business_members bm
    WHERE bm.user_id = u.id
      AND bm.status = :bmStatus
      AND bm.role IN (:...bmRoles)
  )`;

  private async countSuperAdmins(excludeUserId?: number): Promise<number> {
    const qb = this.userRepository
      .createQueryBuilder('u')
      .innerJoin('u.role', 'role')
      .where('role.name = :roleName', { roleName: SUPER_ADMIN_ROLE })
      .andWhere('u.isActive = true');
    if (excludeUserId != null) {
      qb.andWhere('u.id != :excludeUserId', { excludeUserId });
    }
    return qb.getCount();
  }

  async getMeetingRequestsSummary(actor: User): Promise<{
    total: number;
    upcoming: number;
    past: number;
    attended: number;
    onboardingStarted: number;
    createdThisWeek: number;
  }> {
    this.assertSuperAdmin(actor);
    const rows = await this.meetingRequestRepository.find({
      select: [
        'id',
        'scheduledDate',
        'scheduledTime',
        'scheduledDuration',
        'scheduledTimeZone',
        'attendance',
        'salesOutcome',
        'createdAt',
      ],
      order: { id: 'DESC' },
      take: 2000,
    });
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let upcoming = 0;
    let attended = 0;
    let createdThisWeek = 0;
    for (const row of rows) {
      const dealWon = row.salesOutcome === 'DEAL_WON';
      if (isUpcomingMeeting(row, now) && !dealWon) upcoming += 1;
      if (row.attendance === 'ATTENDED') attended += 1;
      if (row.createdAt.getTime() >= weekAgo) createdThisWeek += 1;
    }
    const onboardingStarted = await this.customerOnboardingRepository.count({
      where: { status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED) },
    });
    return {
      total: rows.length,
      upcoming,
      past: rows.length - upcoming,
      attended,
      onboardingStarted,
      createdThisWeek,
    };
  }

  async getMeetingRequests(
    actor: User,
    scope: 'upcoming' | 'past' | 'deal_won' | 'all' = 'all',
    page?: number,
    limit?: number,
    searchRaw?: string,
    sort: 'meeting_asc' | 'meeting_desc' | 'newest' | 'oldest' = 'meeting_asc',
  ): Promise<{
    total: number;
    items: Array<{
      id: number;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      businessName: string;
      businessRole: string;
      businessCategory: string;
      cityLocation: string;
      monthlyRevenue: string;
      marketingActivities: string[];
      currentSituation: string;
      startTimeline: string;
      meetingCommitment: string;
      scheduledDate: string | null;
      scheduledTime: string | null;
      scheduledDuration: number | null;
      scheduledTimeZone: string | null;
      businessPhone: string | null;
      businessEmail: string | null;
      website: string | null;
      description: string | null;
      state: string | null;
      postalCode: string | null;
      country: string | null;
      currency: string | null;
      googleEventLink: string | null;
      googleMeetLink: string | null;
      attendance: string | null;
      salesOutcome: string | null;
      meetingNotes: string | null;
      followUpNotes: string | null;
      outcomeUpdatedAt: Date | null;
      outcomeUpdatedBy: number | null;
      onboardingId: number | null;
      onboardingStatus: string | null;
      businessId: number | null;
      userId: number | null;
      createdAt: Date;
    }>;
    meta: PaginationMeta;
    counts: {
      upcoming: number;
      past: number;
      dealWon: number;
      all: number;
    };
  }> {
    this.assertSuperAdmin(actor);
    const pagination = normalizePagination(page, limit);
    const search = searchRaw?.trim().toLowerCase() ?? '';

    const rows = await this.meetingRequestRepository.find({
      order: { createdAt: 'DESC' },
      take: 2000,
    });

    const now = Date.now();
    let upcomingCount = 0;
    let pastCount = 0;
    let dealWonCount = 0;
    const scoped = rows.filter((row) => {
      const upcoming = isUpcomingMeeting(row, now);
      const dealWon = row.salesOutcome === 'DEAL_WON';
      if (upcoming && !dealWon) upcomingCount += 1;
      else if (!dealWon) pastCount += 1;
      if (dealWon) dealWonCount += 1;
      if (scope === 'upcoming') return upcoming && !dealWon;
      if (scope === 'past') return !upcoming && !dealWon;
      if (scope === 'deal_won') return dealWon;
      return true;
    });

    const searched = search
      ? scoped.filter((row) => {
          const haystack = [
            row.firstName,
            row.lastName,
            row.email,
            row.phone,
            row.businessName,
            row.businessCategory,
            String(row.id),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : scoped;

    searched.sort((a, b) => {
      if (sort === 'oldest') {
        return a.createdAt.getTime() - b.createdAt.getTime();
      }
      if (sort === 'newest') {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      const aKey = `${a.scheduledDate ?? ''}T${a.scheduledTime ?? ''}`;
      const bKey = `${b.scheduledDate ?? ''}T${b.scheduledTime ?? ''}`;
      if (aKey !== bKey) {
        return sort === 'meeting_desc'
          ? bKey.localeCompare(aKey)
          : aKey.localeCompare(bKey);
      }
      return b.id - a.id;
    });

    const total = searched.length;
    const pageRows = searched.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );

    const onboardingLinks =
      pageRows.length === 0
        ? []
        : await this.customerOnboardingRepository.find({
            where: {
              meetingId: In(pageRows.map((row) => row.id)),
              status: Not(CUSTOMER_ONBOARDING_STATUS.CANCELLED),
            },
            select: ['id', 'meetingId', 'status', 'businessId', 'userId'],
          });

    const onboardingByMeeting = new Map(
      onboardingLinks.map((row) => [row.meetingId, row]),
    );

    const businessIds = [
      ...new Set(
        onboardingLinks
          .map((row) => row.businessId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    ];
    const activeBusinessIds = new Set<number>();
    if (businessIds.length > 0) {
      const activeBusinesses = await this.businessRepository.find({
        where: { id: In(businessIds) },
        select: ['id'],
      });
      for (const business of activeBusinesses) {
        activeBusinessIds.add(business.id);
      }
    }

    return {
      total,
      items: pageRows.map((row) => {
        const onboarding = onboardingByMeeting.get(row.id);
        const linkedBusinessId = onboarding?.businessId ?? null;
        const activeBusinessId =
          linkedBusinessId != null && activeBusinessIds.has(linkedBusinessId)
            ? linkedBusinessId
            : null;
        return {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone,
          businessName: row.businessName,
          businessRole: row.businessRole,
          businessCategory: row.businessCategory,
          cityLocation: row.cityLocation,
          monthlyRevenue: row.monthlyRevenue,
          marketingActivities: Array.isArray(row.marketingActivities)
            ? row.marketingActivities
            : [],
          currentSituation: row.currentSituation,
          startTimeline: row.startTimeline,
          meetingCommitment: row.meetingCommitment,
          scheduledDate: row.scheduledDate,
          scheduledTime: row.scheduledTime,
          scheduledDuration: row.scheduledDuration,
          scheduledTimeZone: row.scheduledTimeZone,
          businessPhone: row.businessPhone,
          businessEmail: row.businessEmail,
          website: row.website,
          description: row.description,
          state: row.state,
          postalCode: row.postalCode,
          country: row.country,
          currency: row.currency,
          googleEventLink: row.googleEventLink,
          googleMeetLink: row.googleMeetLink,
          attendance: row.attendance,
          salesOutcome: row.salesOutcome,
          meetingNotes: row.meetingNotes,
          followUpNotes: row.followUpNotes,
          outcomeUpdatedAt: row.outcomeUpdatedAt,
          outcomeUpdatedBy: row.outcomeUpdatedBy,
          onboardingId: onboarding?.id ?? null,
          onboardingStatus: onboarding?.status ?? null,
          businessId: activeBusinessId,
          userId: activeBusinessId ? (onboarding?.userId ?? null) : null,
          createdAt: row.createdAt,
        };
      }),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      counts: {
        upcoming: upcomingCount,
        past: pastCount,
        dealWon: dealWonCount,
        all: rows.length,
      },
    };
  }

  async exportMeetingRequestsCsv(
    actor: User,
    scope: 'upcoming' | 'past' | 'deal_won' | 'all' = 'all',
    search?: string,
  ): Promise<string> {
    const result = await this.getMeetingRequests(
      actor,
      scope,
      1,
      2000,
      search,
      'meeting_asc',
    );
    const header = [
      'id',
      'visitor',
      'email',
      'phone',
      'business',
      'category',
      'scheduledDate',
      'scheduledTime',
      'timeZone',
      'attendance',
      'salesOutcome',
      'onboardingId',
      'onboardingStatus',
      'createdAt',
    ];
    const lines = result.items.map((row) =>
      [
        row.id,
        `${row.firstName} ${row.lastName}`.trim(),
        row.email,
        row.phone,
        row.businessName,
        row.businessCategory,
        row.scheduledDate ?? '',
        row.scheduledTime ?? '',
        row.scheduledTimeZone ?? '',
        row.attendance ?? '',
        row.salesOutcome ?? '',
        row.onboardingId ?? '',
        row.onboardingStatus ?? '',
        row.createdAt.toISOString(),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  async getNotifications(
    actor: User,
    page?: number,
    limit?: number,
    status: 'read' | 'unread' = 'read',
  ): Promise<{
    unreadCount: number;
    items: Array<{
      id: string;
      type: string;
      eventKey: string;
      title: string;
      body: string;
      severity: string;
      actionUrl: string | null;
      resourceType: string | null;
      resourceId: string | null;
      isRead: boolean;
      createdAt: Date;
    }>;
    meta: PaginationMeta;
  }> {
    this.assertSuperAdmin(actor);

    const pagination = normalizePagination(page, limit);
    const listWhere =
      status === 'unread'
        ? { isArchived: false, isRead: false }
        : { isArchived: false, isRead: true };

    const [items, total, unreadCount] = await Promise.all([
      this.adminNotificationRepository.find({
        where: listWhere,
        order: { createdAt: 'DESC' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.adminNotificationRepository.count({ where: listWhere }),
      this.countUnreadNotifications(),
    ]);

    return {
      unreadCount,
      items: items.map((row) => ({
        id: row.id,
        type: row.type,
        eventKey: row.eventKey,
        title: row.title,
        body: row.body,
        severity: row.severity,
        actionUrl: row.actionUrl,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        isRead: row.isRead,
        createdAt: row.createdAt,
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getNotificationsUnreadCount(
    actor: User,
  ): Promise<{ unreadCount: number }> {
    this.assertSuperAdmin(actor);
    return { unreadCount: await this.countUnreadNotifications() };
  }

  private async countUnreadNotifications(): Promise<number> {
    return this.adminNotificationRepository.count({
      where: { isArchived: false, isRead: false },
    });
  }

  async markNotificationRead(
    actor: User,
    notificationId: string,
  ): Promise<{
    id: string;
    isRead: boolean;
    readAt: Date | null;
    unreadCount: number;
  }> {
    this.assertSuperAdmin(actor);

    const notification = await this.adminNotificationRepository.findOne({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    if (!notification.isRead) {
      const readAt = new Date();
      notification.isRead = true;
      notification.readAt = readAt;
      await this.adminNotificationRepository.save(notification);
    }

    const unreadCount = await this.countUnreadNotifications();

    return {
      id: notification.id,
      isRead: notification.isRead,
      readAt: notification.readAt,
      unreadCount,
    };
  }

  async markAllNotificationsRead(actor: User): Promise<{
    updatedCount: number;
    unreadCount: number;
  }> {
    this.assertSuperAdmin(actor);

    const readAt = new Date();

    const result = await this.adminNotificationRepository.update(
      { isRead: false, isArchived: false },
      { isRead: true, readAt },
    );

    return {
      updatedCount: result.affected ?? 0,
      unreadCount: 0,
    };
  }

  async getTrends(
    actor: User,
    fromRaw?: string,
    toRaw?: string,
    timeZoneRaw?: string,
  ): Promise<{
    from: string;
    to: string;
    totalRevenueCents: number;
    newBusinesses: number;
    newUsers: number;
    newSubscriptions: number;
    points: Array<{
      bucket: string;
      revenueCents: number;
      businesses: number;
      users: number;
      subscriptions: number;
    }>;
  }> {
    this.assertSuperAdmin(actor);

    const from = new Date(fromRaw ?? '');
    const to = new Date(toRaw ?? '');
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      throw new BadRequestException('Choose a valid day or month.');
    }

    if (to.getTime() - from.getTime() > 62 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('That date range is too long.');
    }

    const chartTz = resolveSafeTimeZone(timeZoneRaw);
    const { sameDay, keys } = buildZonedRangeBucketKeys(from, to, chartTz);
    const startedAt = 'COALESCE(sub.started_at, sub.created_at)';
    const subscriptionBucket = overviewRangeBucketSql(
      startedAt,
      sameDay,
      chartTz,
    );
    const businessBucket = overviewRangeBucketSql(
      'b.created_at',
      sameDay,
      chartTz,
    );
    const userBucket = overviewRangeBucketSql(
      'u.created_at',
      sameDay,
      chartTz,
    );
    const subscriptionAmountSql = `
      CASE
        WHEN sub.billing_cycle = 'annual'
          THEN COALESCE(plan."yearlyPrice", 0) * 100
        ELSE COALESCE(plan."monthlyPrice", 0) * 100
      END
    `;

    const [revenueRows, businessRows, userRows] = await Promise.all([
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoin('sub.plan', 'plan')
        .select(subscriptionBucket, 'bucket')
        .addSelect(`COALESCE(SUM(${subscriptionAmountSql}), 0)`, 'total')
        .addSelect('COUNT(*)', 'count')
        .where(`${startedAt} >= :from`, { from })
        .andWhere(`${startedAt} <= :to`, { to })
        .groupBy(subscriptionBucket)
        .getRawMany<Record<string, string>>(),
      this.businessRepository
        .createQueryBuilder('b')
        .select(businessBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('b.created_at >= :from', { from })
        .andWhere('b.created_at <= :to', { to })
        .groupBy(businessBucket)
        .getRawMany<{ bucket: string; count: string }>(),
      this.userRepository
        .createQueryBuilder('u')
        .select(userBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('u.created_at >= :from', { from })
        .andWhere('u.created_at <= :to', { to })
        .groupBy(userBucket)
        .getRawMany<{ bucket: string; count: string }>(),
    ]);

    const revenueMap = new Map(
      revenueRows.map((row) => [
        String(row.bucket ?? ''),
        Math.round(Number(row.total) || 0),
      ]),
    );
    const subscriptionMap = new Map(
      revenueRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const businessMap = new Map(
      businessRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const userMap = new Map(
      userRows.map((row) => [String(row.bucket ?? ''), Number(row.count) || 0]),
    );
    const points = keys.map((bucket) => ({
      bucket,
      revenueCents: revenueMap.get(bucket) ?? 0,
      businesses: businessMap.get(bucket) ?? 0,
      users: userMap.get(bucket) ?? 0,
      subscriptions: subscriptionMap.get(bucket) ?? 0,
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalRevenueCents: points.reduce(
        (sum, point) => sum + point.revenueCents,
        0,
      ),
      newBusinesses: points.reduce((sum, point) => sum + point.businesses, 0),
      newUsers: points.reduce((sum, point) => sum + point.users, 0),
      newSubscriptions: points.reduce(
        (sum, point) => sum + point.subscriptions,
        0,
      ),
      points,
    };
  }

  async getKpis(actor: User): Promise<PlatformAdminOverview['kpis']> {
    this.assertSuperAdmin(actor);
    return this.computeKpis();
  }

  async getDashboardPanel(
    actor: User,
    periodRaw?: string,
    monthKeyRaw?: string,
    timeZoneRaw?: string,
  ): Promise<PlatformDashboardPanel> {
    this.assertSuperAdmin(actor);

    const period = normalizeDashboardPeriod(periodRaw);
    const chartTz = resolveSafeTimeZone(timeZoneRaw);
    const { from, to, label, priorFrom, priorTo, useMonthBuckets } =
      resolveDashboardWindow(period, monthKeyRaw, chartTz);

    const day30Ago = addDays(startOfDay(new Date()), -29);
    const day60Ago = addDays(startOfDay(new Date()), -59);

    const [
      trendCurrent,
      trendPrior,
      mrrNow,
      mrrAtPeriodStart,
      totalUsers,
      usersLast30,
      usersPrev30,
      countryCounts,
    ] = await Promise.all([
      this.computeTrendWindow(from, to, chartTz, useMonthBuckets),
      this.computeTrendWindow(priorFrom, priorTo, chartTz, useMonthBuckets),
      this.computePlatformMrrSnapshot(),
      this.computePlatformMrrSnapshot(from),
      this.userRepository.count(),
      this.userRepository.count({
        where: { createdAt: MoreThanOrEqual(day30Ago) },
      }),
      this.userRepository.count({
        where: { createdAt: Between(day60Ago, day30Ago) },
      }),
      this.businessRepository
        .createQueryBuilder('b')
        .select('b.country', 'country')
        .addSelect('COUNT(*)', 'count')
        .groupBy('b.country')
        .getRawMany<{ country: string | null; count: string }>(),
    ]);

    const spark = (points: number[]) =>
      points.length > 0 ? points.slice(-12) : [0];

    const earningsSpark = spark(
      trendCurrent.points.map((point) => point.revenueCents / 100),
    );
    const subsSpark = spark(
      trendCurrent.points.map((point) => point.subscriptions),
    );
    const usersSpark = spark(trendCurrent.points.map((point) => point.users));

    const chartLabel = (bucket: string) =>
      formatDashboardBucketLabel(bucket, useMonthBuckets);

    return {
      period,
      label,
      from: from.toISOString(),
      to: to.toISOString(),
      kpis: {
        mrr: {
          value: mrrNow.mrrCents,
          changePct: pctChange(mrrNow.mrrCents, mrrAtPeriodStart.mrrCents),
          sparkline: earningsSpark,
          hint: 'Monthly earnings from active plans',
        },
        planEarnings: {
          value: trendCurrent.totalRevenueCents,
          changePct: pctChange(
            trendCurrent.totalRevenueCents,
            trendPrior.totalRevenueCents,
          ),
          sparkline: earningsSpark,
          hint: `${label} · new subscriptions`,
        },
        platformUsers: {
          value: totalUsers,
          changePct: pctChange(usersLast30, usersPrev30),
          sparkline: usersSpark,
          hint: 'vs prior 30 days',
        },
        payingSubscriptions: {
          value: mrrNow.payingCount,
          changePct: pctChange(
            mrrNow.payingCount,
            mrrAtPeriodStart.payingCount,
          ),
          sparkline: subsSpark,
          hint: 'Active Dealioo plans · vs start of period',
        },
        newPlans: {
          value: trendCurrent.newSubscriptions,
          changePct: pctChange(
            trendCurrent.newSubscriptions,
            trendPrior.newSubscriptions,
          ),
          sparkline: subsSpark,
          hint: `${label} · subscriptions started`,
        },
      },
      charts: {
        planEarnings: trendCurrent.points.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.revenueCents / 100,
        })),
        subscriptions: trendCurrent.points.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.subscriptions,
        })),
        users: trendCurrent.points.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.users,
        })),
        businesses: trendCurrent.points.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.businesses,
        })),
      },
      regions: buildRegionBreakdownFromCountryCounts(
        countryCounts.map((row) => ({
          country: row.country,
          count: Number(row.count) || 0,
        })),
      ),
    };
  }

  private async computePlatformMrrSnapshot(startedBefore?: Date): Promise<{
    mrrCents: number;
    payingCount: number;
  }> {
    const qb = this.subscriptionRepository
      .createQueryBuilder('sub')
      .innerJoin('sub.plan', 'plan')
      .select(
        `COALESCE(SUM(
          CASE
            WHEN sub.billing_cycle = 'annual'
              THEN COALESCE(plan."yearlyPrice", 0) * 100 / 12.0
            ELSE COALESCE(plan."monthlyPrice", 0) * 100
          END
        ), 0)`,
        'mrr',
      )
      .addSelect('COUNT(*)', 'count')
      .where('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      });

    if (startedBefore) {
      qb.andWhere('COALESCE(sub.started_at, sub.created_at) < :startedBefore', {
        startedBefore,
      });
    }

    const row = await qb.getRawOne<{ mrr: string; count: string }>();
    return {
      mrrCents: Math.round(Number(row?.mrr) || 0),
      payingCount: Number(row?.count) || 0,
    };
  }

  private parseUsersTab(raw?: string): AdminUsersTab {
    const value = (raw ?? 'all').trim().toLowerCase();
    if (
      value === 'active' ||
      value === 'inactive' ||
      value === 'admins' ||
      value === 'managers' ||
      value === 'viewers'
    ) {
      return value;
    }
    return 'all';
  }

  private parseUsersSort(raw?: string): AdminUsersSort {
    const value = (raw ?? 'newest').trim().toLowerCase();
    if (
      value === 'oldest' ||
      value === 'name_asc' ||
      value === 'name_desc'
    ) {
      return value;
    }
    return 'newest';
  }

  private applyUsersTabFilter(
    qb: {
      andWhere: (where: string, params?: Record<string, unknown>) => unknown;
    },
    tab: AdminUsersTab,
  ): void {
    if (tab === 'active') {
      qb.andWhere('u.isActive = true');
    } else if (tab === 'inactive') {
      qb.andWhere('u.isActive = false');
    } else if (tab === 'admins') {
      qb.andWhere(
        `(role.name IN (:...adminRoles) OR ${this.usersWithBusinessRolesSql})`,
        {
          adminRoles: [ADMIN_ROLE, SUPER_ADMIN_ROLE],
          bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
          bmRoles: ['Owner', 'Admin'],
        },
      );
    } else if (tab === 'managers') {
      qb.andWhere(this.usersWithBusinessRolesSql, {
        bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        bmRoles: ['Manager'],
      });
    } else if (tab === 'viewers') {
      qb.andWhere(this.usersWithBusinessRolesSql, {
        bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        bmRoles: ['Staff', 'Scanner'],
      });
    }
  }

  private async buildUsersSummary(
    actorId: number,
  ): Promise<AdminUsersSummary> {
    const now = new Date();
    const last30Start = addDays(startOfDay(now), -29);
    const prev30Start = addDays(last30Start, -30);

    const base = () =>
      this.userRepository
        .createQueryBuilder('u')
        .leftJoin('u.role', 'role')
        .where('u.id != :actorId', { actorId });

    const countWithBusinessRoles = (roles: string[]) =>
      base()
        .andWhere(this.usersWithBusinessRolesSql, {
          bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
          bmRoles: roles,
        })
        .getCount();

    const [
      total,
      active,
      inactive,
      admins,
      managers,
      viewers,
      newUsers,
      prevNewUsers,
      totalPrev,
    ] = await Promise.all([
      base().getCount(),
      base().andWhere('u.isActive = true').getCount(),
      base().andWhere('u.isActive = false').getCount(),
      base()
        .andWhere(
          `(role.name IN (:...adminRoles) OR ${this.usersWithBusinessRolesSql})`,
          {
            adminRoles: [ADMIN_ROLE, SUPER_ADMIN_ROLE],
            bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
            bmRoles: ['Owner', 'Admin'],
          },
        )
        .getCount(),
      countWithBusinessRoles(['Manager']),
      countWithBusinessRoles(['Staff', 'Scanner']),
      base()
        .andWhere('u.createdAt >= :from', { from: last30Start })
        .getCount(),
      base()
        .andWhere('u.createdAt >= :from AND u.createdAt < :to', {
          from: prev30Start,
          to: last30Start,
        })
        .getCount(),
      base()
        .andWhere('u.createdAt < :cutoff', { cutoff: last30Start })
        .getCount(),
    ]);

    const totalAtPrevEnd = totalPrev;
    const totalChangePct = pctChange(total, totalAtPrevEnd);
    const newUsersChangePct = pctChange(newUsers, prevNewUsers);
    const activeSharePct =
      total > 0 ? Math.round((active / total) * 1000) / 10 : 0;
    const inactiveSharePct =
      total > 0 ? Math.round((inactive / total) * 1000) / 10 : 0;

    return {
      total,
      newUsers,
      active,
      inactive,
      totalChangePct,
      newUsersChangePct,
      activeSharePct,
      inactiveSharePct,
      tabs: {
        all: total,
        active,
        inactive,
        admins,
        managers,
        viewers,
      },
    };
  }

  async listUsers(
    actor: User,
    page?: number,
    limit?: number,
    searchRaw?: string,
    tabRaw?: string,
    sortRaw?: string,
  ): Promise<{
    items: PlatformAdminOverview['users'];
    meta: PaginationMeta;
    summary: AdminUsersSummary;
  }> {
    this.assertSuperAdmin(actor);
    const pagination = normalizePagination(page, limit);
    const search = searchRaw?.trim() ?? '';
    const tab = this.parseUsersTab(tabRaw);
    const sort = this.parseUsersSort(sortRaw);

    const qb = this.userRepository
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'role')
      .where('u.id != :actorId', { actorId: actor.id });

    this.applyUsersTabFilter(qb, tab);

    if (search) {
      qb.andWhere(
        `(
          u.name ILIKE :q
          OR u.email ILIKE :q
          OR CAST(u.id AS text) ILIKE :q
          OR role.name ILIKE :q
          OR EXISTS (
            SELECT 1
            FROM business_members bm_search
            INNER JOIN businesses b_search ON b_search.id = bm_search.business_id
            WHERE bm_search.user_id = u.id
              AND bm_search.status = :searchBmStatus
              AND (
                b_search.name ILIKE :q
                OR bm_search.role ILIKE :q
              )
          )
        )`,
        {
          q: `%${search}%`,
          searchBmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        },
      );
    }

    if (sort === 'oldest') {
      qb.orderBy('u.createdAt', 'ASC');
    } else if (sort === 'name_asc') {
      qb.orderBy('u.name', 'ASC');
    } else if (sort === 'name_desc') {
      qb.orderBy('u.name', 'DESC');
    } else {
      qb.orderBy('u.createdAt', 'DESC');
    }

    qb.skip(pagination.skip).take(pagination.limit);

    const [[users, total], summary] = await Promise.all([
      qb.getManyAndCount(),
      this.buildUsersSummary(actor.id),
    ]);
    const userIds = users.map((user) => user.id);
    const [planByUserId, businessByUserId] = await Promise.all([
      this.loadPlanMapForUserIds(userIds),
      this.loadBusinessMapForUserIds(userIds),
    ]);

    return {
      items: users.map((user) =>
        this.toAdminUserItem(
          user,
          planByUserId.get(user.id) ?? null,
          businessByUserId.get(user.id) ?? [],
        ),
      ),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      summary,
    };
  }

  async createUser(
    actor: User,
    dto: CreateAdminUserDto,
  ): Promise<PlatformAdminOverview['users'][number]> {
    this.assertSuperAdmin(actor);

    const email = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const roleName = dto.roleName.trim();
    if (!PLATFORM_ROLES.includes(roleName as (typeof PLATFORM_ROLES)[number])) {
      throw new BadRequestException(
        'That role cannot be assigned from Super Admin.',
      );
    }
    if (
      isSuperAdminRole(roleName) &&
      dto.confirmElevateToSuperAdmin !== true
    ) {
      throw new BadRequestException(
        'Confirm Super Admin assignment to create another Super Admin.',
      );
    }
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role '${roleName}' does not exist.`);
    }

    const phone = dto.phone?.trim() ?? '';
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = this.userRepository.create({
      name: dto.name.trim(),
      email,
      phone: phone.length > 0 ? phone : null,
      passwordHash,
      role,
      createdBy: actor,
      isActive: true,
      emailVerified: true,
      provider: 'LOCAL',
    });
    const saved = await this.userRepository.save(created);
    await this.writeAudit({
      actorUserId: actor.id,
      action: 'user.create',
      targetType: 'user',
      targetId: saved.id,
      metadata: {
        email: saved.email,
        roleName,
        elevatedToSuperAdmin: isSuperAdminRole(roleName),
      },
    });
    const withRole = await this.userRepository.findOne({
      where: { id: saved.id },
      relations: ['role'],
    });
    return this.toAdminUserItem(withRole ?? saved, null, []);
  }

  async listAssignableRoles(
    actor: User,
  ): Promise<{ items: Array<{ name: string }> }> {
    this.assertSuperAdmin(actor);
    const roles = await this.roleRepository.find({
      where: { name: In([...PLATFORM_ROLES]) },
      order: { name: 'ASC' },
    });
    return {
      items: roles.map((role) => ({ name: role.name })),
    };
  }

  async updateUser(
    actor: User,
    userId: number,
    dto: UpdateAdminUserDto,
  ): Promise<PlatformAdminOverview['users'][number]> {
    this.assertSuperAdmin(actor);

    const hasChange =
      dto.name !== undefined ||
      dto.email !== undefined ||
      dto.phone !== undefined ||
      dto.isActive !== undefined;
    if (!hasChange) {
      throw new BadRequestException('No changes were provided.');
    }

    const target = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }

    const wasSuperAdmin = isSuperAdminRole(target.role?.name);
    const isSelf = actor.id === target.id;
    const before = {
      name: target.name,
      email: target.email,
      phone: target.phone,
      isActive: target.isActive,
    };

    if (dto.name !== undefined) {
      target.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== target.email.toLowerCase()) {
        const existing = await this.userRepository.findOne({
          where: { email },
        });
        if (existing && existing.id !== target.id) {
          throw new ConflictException(
            'An account with this email already exists.',
          );
        }
        target.email = email;
      }
    }

    if (dto.phone !== undefined) {
      const phone = dto.phone.trim();
      target.phone = phone.length > 0 ? phone : null;
    }

    if (dto.isActive !== undefined) {
      if (isSelf && dto.isActive === false) {
        throw new BadRequestException('You cannot deactivate your own account.');
      }

      if (
        wasSuperAdmin &&
        target.isActive &&
        dto.isActive === false &&
        (await this.countSuperAdmins(target.id)) < 1
      ) {
        throw new BadRequestException(
          'At least one active Super Admin must remain.',
        );
      }

      target.isActive = dto.isActive;
    }

    const saved = await this.userRepository.save(target);
    this.jwtStrategy.invalidateUserCache(saved.id);
    await this.writeAudit({
      actorUserId: actor.id,
      action: 'user.update',
      targetType: 'user',
      targetId: saved.id,
      metadata: {
        before,
        after: {
          name: saved.name,
          email: saved.email,
          phone: saved.phone,
          isActive: saved.isActive,
        },
      },
    });
    const withRole = await this.userRepository.findOne({
      where: { id: saved.id },
      relations: ['role'],
    });
    const [planByUserId, businessByUserId] = await Promise.all([
      this.loadPlanMapForUserIds([saved.id]),
      this.loadBusinessMapForUserIds([saved.id]),
    ]);
    return this.toAdminUserItem(
      withRole ?? saved,
      planByUserId.get(saved.id) ?? null,
      businessByUserId.get(saved.id) ?? [],
    );
  }

  private resolveBusinessIntegrationFlags(business: Business): {
    stripeConnected: boolean;
    metaConnected: boolean;
    googleAdsConnected: boolean;
    twilioConnected: boolean;
  } {
    const stripeConnected = Boolean(business.stripeAccountId?.trim());

    const metaStatus = (business.metaConnectionStatus ?? '').trim().toUpperCase();
    const metaReadyStatus =
      metaStatus === 'AD_ACCOUNT_SELECTED' ||
      metaStatus === 'ACTIVE' ||
      metaStatus === 'SYNCING';
    const metaConnected = Boolean(
      business.metaUserId?.trim() &&
        business.metaAdAccountId?.trim() &&
        metaReadyStatus,
    );

    const googleStatus = (business.googleConnectionStatus ?? '')
      .trim()
      .toUpperCase();
    const googleReadyStatus =
      googleStatus === 'CUSTOMER_SELECTED' ||
      googleStatus === 'ACTIVE' ||
      googleStatus === 'SYNCING' ||
      googleStatus === 'TOKEN_EXCHANGED';
    const googleAdsConnected = Boolean(
      business.googleUserId?.trim() && googleReadyStatus,
    );

    const twilioConnected = Boolean(
      business.twilioPhoneSid?.trim() && business.twilioPhoneNumber?.trim(),
    );

    return {
      stripeConnected,
      metaConnected,
      googleAdsConnected,
      twilioConnected,
    };
  }

  private toAdminBusinessItem(
    business: Business,
  ): PlatformAdminOverview['businesses'][number] {
    const flags = this.resolveBusinessIntegrationFlags(business);
    const setupProgressPercent = computeBusinessSetupProgressFromEntity(
      business,
      flags,
    );
    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      logoUrl: business.logoUrl,
      city: business.city,
      state: business.state,
      country: business.country,
      postalCode: business.postalCode,
      email: business.email,
      phoneNumber: business.phoneNumber,
      onboardingCompleted: business.onboardingCompleted,
      stripeConnected: flags.stripeConnected,
      metaConnected: flags.metaConnected,
      googleAdsConnected: flags.googleAdsConnected,
      twilioConnected: flags.twilioConnected,
      setupProgressPercent,
      setupComplete: setupProgressPercent === 100,
      createdAt: business.createdAt,
      ownerName: business.owner?.name ?? null,
      ownerEmail: business.owner?.email ?? null,
      ownerAvatar: business.owner?.avatar ?? null,
      planName: null,
      planSlug: null,
    };
  }

  private async resolveUniqueBusinessSlug(source: string): Promise<string> {
    const base = slugifyBusinessName(source) || 'business';
    const root = isValidBusinessSlug(base) ? base : 'business';

    let candidate = root;
    let suffix = 2;

    while (
      await this.businessRepository.exists({ where: { slug: candidate } })
    ) {
      candidate = `${root}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  async createBusiness(
    actor: User,
    dto: CreateAdminBusinessDto,
  ): Promise<PlatformAdminOverview['businesses'][number]> {
    this.assertSuperAdmin(actor);

    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Business name is required.');
    }

    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const owner = await this.userRepository.findOne({
      where: { email: ownerEmail },
    });
    if (!owner) {
      throw new NotFoundException(
        'No user found with that owner email. Create the user first.',
      );
    }
    if (!owner.isActive) {
      throw new BadRequestException('The selected owner account is inactive.');
    }

    const phoneNumber = dto.phoneNumber?.trim() || '';
    if (!phoneNumber) {
      throw new BadRequestException('Phone number is required.');
    }
    const businessType = dto.businessType?.trim() || '';
    if (!businessType) {
      throw new BadRequestException('Business type is required.');
    }
    const currency = (dto.currency?.trim() || '').toUpperCase();
    if (!currency) {
      throw new BadRequestException('Currency is required.');
    }

    const slugSource = dto.slug?.trim() || name;
    const slug = await this.resolveUniqueBusinessSlug(slugSource);
    const createdAt = new Date();

    const business = this.businessRepository.create({
      name,
      slug,
      description: dto.description?.trim() || null,
      logoUrl: null,
      businessType,
      currency,
      websiteUrl: dto.websiteUrl?.trim() || null,
      email: dto.email?.trim() || null,
      phoneNumber,
      city: dto.city?.trim() || null,
      state: dto.state?.trim() || null,
      country: dto.country?.trim() || null,
      postalCode: dto.postalCode?.trim() || null,
      branchCount: 0,
      owner,
      onboardingCompleted: true,
      onboardingCompletedAt: createdAt,
    });
    const saved = await this.businessRepository.save(business);

    const ownerRole = await this.roleRepository.findOne({
      where: { name: ADMIN_ROLE },
    });
    await this.businessMemberRepository.save(
      this.businessMemberRepository.create({
        business: saved,
        user: owner,
        role: 'Owner',
        memberRole: ownerRole,
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
        invitedBy: null,
        joinedAt: createdAt,
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
      }),
    );

    const withOwner = await this.businessRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.owner', 'owner')
      .select([
        'b.id',
        'b.name',
        'b.slug',
        'b.logoUrl',
        'b.city',
        'b.state',
        'b.country',
        'b.postalCode',
        'b.email',
        'b.phoneNumber',
        'b.onboardingCompleted',
        'b.createdAt',
        'b.stripeAccountId',
        'b.metaUserId',
        'b.metaAdAccountId',
        'b.metaConnectionStatus',
        'b.googleUserId',
        'b.googleConnectionStatus',
        'b.twilioPhoneSid',
        'b.twilioPhoneNumber',
        'owner.id',
        'owner.name',
        'owner.email',
        'owner.avatar',
      ])
      .where('b.id = :id', { id: saved.id })
      .getOne();
    await this.writeAudit({
      actorUserId: actor.id,
      action: 'business.create',
      targetType: 'business',
      targetId: saved.id,
      metadata: {
        name: saved.name,
        slug: saved.slug,
        ownerEmail,
      },
    });
    return this.toAdminBusinessItem(withOwner ?? saved);
  }

  async listBusinesses(
    actor: User,
    page?: number,
    limit?: number,
    searchRaw?: string,
    onboardingRaw?: string,
  ): Promise<{
    items: PlatformAdminOverview['businesses'];
    meta: PaginationMeta;
    counts: { all: number; onboarded: number; notOnboarded: number };
  }> {
    this.assertSuperAdmin(actor);
    const pagination = normalizePagination(page, limit);
    const search = searchRaw?.trim() ?? '';
    const setupFilter = (onboardingRaw ?? 'all').trim().toLowerCase();

    const qb = this.businessRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.owner', 'owner')
      .select([
        'b.id',
        'b.name',
        'b.slug',
        'b.logoUrl',
        'b.city',
        'b.state',
        'b.country',
        'b.postalCode',
        'b.email',
        'b.phoneNumber',
        'b.onboardingCompleted',
        'b.createdAt',
        'b.stripeAccountId',
        'b.metaUserId',
        'b.metaAdAccountId',
        'b.metaConnectionStatus',
        'b.googleUserId',
        'b.googleConnectionStatus',
        'b.twilioPhoneSid',
        'b.twilioPhoneNumber',
        'owner.id',
        'owner.name',
        'owner.email',
        'owner.avatar',
      ])
      .orderBy('b.createdAt', 'DESC');

    if (search) {
      qb.andWhere(
        `(b.name ILIKE :q OR b.slug ILIKE :q OR owner.name ILIKE :q OR owner.email ILIKE :q OR CAST(b.id AS text) ILIKE :q)`,
        { q: `%${search}%` },
      );
    }

    const businesses = await qb.getMany();
    const mapped = businesses.map((business) =>
      this.toAdminBusinessItem(business),
    );
    const completed = mapped.filter((item) => item.setupComplete);
    const inProgress = mapped.filter((item) => !item.setupComplete);

    const filtered =
      setupFilter === 'onboarded'
        ? completed
        : setupFilter === 'not_onboarded'
          ? inProgress
          : mapped;

    const total = filtered.length;
    const items = filtered.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );

    return {
      items,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      counts: {
        all: mapped.length,
        onboarded: completed.length,
        notOnboarded: inProgress.length,
      },
    };
  }

  private async loadPlanMapForUserIds(
    userIds: number[],
  ): Promise<Map<number, { planName: string; planSlug: string }>> {
    const planByUserId = new Map<
      number,
      { planName: string; planSlug: string }
    >();
    if (userIds.length === 0) return planByUserId;

    const userSubs = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .where('sub.userId IN (:...userIds)', { userIds })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing', 'past_due'],
      })
      .orderBy('sub.createdAt', 'DESC')
      .getMany();

    for (const sub of userSubs) {
      if (!planByUserId.has(sub.userId)) {
        planByUserId.set(sub.userId, {
          planName: sub.plan?.name ?? '—',
          planSlug: sub.plan?.slug ?? 'unknown',
        });
      }
    }
    return planByUserId;
  }

  private async computeTrendWindow(
    from: Date,
    to: Date,
    chartTz: string,
    useMonthBuckets: boolean,
  ): Promise<{
    totalRevenueCents: number;
    newBusinesses: number;
    newUsers: number;
    newSubscriptions: number;
    points: Array<{
      bucket: string;
      revenueCents: number;
      businesses: number;
      users: number;
      subscriptions: number;
    }>;
  }> {
    const startedAt = 'COALESCE(sub.started_at, sub.created_at)';
    const subscriptionAmountSql = `
      CASE
        WHEN sub.billing_cycle = 'annual'
          THEN COALESCE(plan."yearlyPrice", 0) * 100
        ELSE COALESCE(plan."monthlyPrice", 0) * 100
      END
    `;

    let keys: string[];
    let subscriptionBucket: string;
    let businessBucket: string;
    let userBucket: string;

    if (useMonthBuckets) {
      keys = buildMonthBucketKeys(from, to, chartTz);
      const tz = chartTz.replace(/'/g, "''");
      subscriptionBucket = `TO_CHAR(DATE_TRUNC('month', ${startedAt} AT TIME ZONE '${tz}'), 'YYYY-MM')`;
      businessBucket = `TO_CHAR(DATE_TRUNC('month', b.created_at AT TIME ZONE '${tz}'), 'YYYY-MM')`;
      userBucket = `TO_CHAR(DATE_TRUNC('month', u.created_at AT TIME ZONE '${tz}'), 'YYYY-MM')`;
    } else {
      const built = buildZonedRangeBucketKeys(from, to, chartTz);
      keys = built.keys;
      subscriptionBucket = overviewRangeBucketSql(
        startedAt,
        built.sameDay,
        chartTz,
      );
      businessBucket = overviewRangeBucketSql(
        'b.created_at',
        built.sameDay,
        chartTz,
      );
      userBucket = overviewRangeBucketSql(
        'u.created_at',
        built.sameDay,
        chartTz,
      );
    }

    const [revenueRows, businessRows, userRows] = await Promise.all([
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoin('sub.plan', 'plan')
        .select(subscriptionBucket, 'bucket')
        .addSelect(`COALESCE(SUM(${subscriptionAmountSql}), 0)`, 'total')
        .addSelect('COUNT(*)', 'count')
        .where(`${startedAt} >= :from`, { from })
        .andWhere(`${startedAt} <= :to`, { to })
        .groupBy(subscriptionBucket)
        .getRawMany<Record<string, string>>(),
      this.businessRepository
        .createQueryBuilder('b')
        .select(businessBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('b.created_at >= :from', { from })
        .andWhere('b.created_at <= :to', { to })
        .groupBy(businessBucket)
        .getRawMany<{ bucket: string; count: string }>(),
      this.userRepository
        .createQueryBuilder('u')
        .select(userBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('u.created_at >= :from', { from })
        .andWhere('u.created_at <= :to', { to })
        .groupBy(userBucket)
        .getRawMany<{ bucket: string; count: string }>(),
    ]);

    const revenueMap = new Map(
      revenueRows.map((row) => [
        String(row.bucket ?? ''),
        Math.round(Number(row.total) || 0),
      ]),
    );
    const subscriptionMap = new Map(
      revenueRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const businessMap = new Map(
      businessRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const userMap = new Map(
      userRows.map((row) => [String(row.bucket ?? ''), Number(row.count) || 0]),
    );

    const points = keys.map((bucket) => ({
      bucket,
      revenueCents: revenueMap.get(bucket) ?? 0,
      businesses: businessMap.get(bucket) ?? 0,
      users: userMap.get(bucket) ?? 0,
      subscriptions: subscriptionMap.get(bucket) ?? 0,
    }));

    return {
      totalRevenueCents: points.reduce(
        (sum, point) => sum + point.revenueCents,
        0,
      ),
      newBusinesses: points.reduce((sum, point) => sum + point.businesses, 0),
      newUsers: points.reduce((sum, point) => sum + point.users, 0),
      newSubscriptions: points.reduce(
        (sum, point) => sum + point.subscriptions,
        0,
      ),
      points,
    };
  }

  private async computeKpis(): Promise<PlatformAdminOverview['kpis']> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = addDays(todayStart, -1);
    const day30Ago = addDays(todayStart, -29);
    const day60Ago = addDays(todayStart, -59);
    const payingStatuses = ['active', 'trialing'] as const;

    const [
      totalUsers,
      totalBusinesses,
      activeBusinesses,
      newUsersToday,
      newUsersYesterday,
      activeSubscriptions,
      newSubscriptionsToday,
      newSubscriptionsYesterday,
      businessesLast30,
      businessesPrev30,
      usersLast30,
      usersPrev30,
      payingSubs,
    ] = await Promise.all([
      this.userRepository.count(),
      this.businessRepository.count(),
      this.businessRepository.count({ where: { onboardingCompleted: true } }),
      this.userRepository.count({
        where: { createdAt: MoreThanOrEqual(todayStart) },
      }),
      this.userRepository.count({
        where: { createdAt: Between(yesterdayStart, todayStart) },
      }),
      this.subscriptionRepository.count({
        where: { status: In([...payingStatuses]) },
      }),
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .where('COALESCE(sub.started_at, sub.created_at) >= :from', {
          from: todayStart,
        })
        .getCount(),
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .where('COALESCE(sub.started_at, sub.created_at) >= :from', {
          from: yesterdayStart,
        })
        .andWhere('COALESCE(sub.started_at, sub.created_at) < :to', {
          to: todayStart,
        })
        .getCount(),
      this.businessRepository.count({
        where: { createdAt: MoreThanOrEqual(day30Ago) },
      }),
      this.businessRepository.count({
        where: { createdAt: Between(day60Ago, day30Ago) },
      }),
      this.userRepository.count({
        where: { createdAt: MoreThanOrEqual(day30Ago) },
      }),
      this.userRepository.count({
        where: { createdAt: Between(day60Ago, day30Ago) },
      }),
      this.subscriptionRepository.find({
        where: { status: In([...payingStatuses]) },
        relations: ['plan'],
      }),
    ]);

    let platformMrrCents = 0;
    for (const sub of payingSubs) {
      const monthly = Number(sub.plan?.monthlyPrice ?? 0);
      const yearly = Number(sub.plan?.yearlyPrice ?? 0);
      if (sub.billingCycle === 'annual') {
        platformMrrCents += Math.round((yearly * 100) / 12);
      } else {
        platformMrrCents += Math.round(monthly * 100);
      }
    }

    return {
      totalBusinesses,
      activeBusinesses,
      totalUsers,
      newUsersToday,
      ordersToday: activeSubscriptions,
      revenueTodayCents: platformMrrCents,
      businessesChangePct: pctChange(businessesLast30, businessesPrev30),
      activeBusinessesChangePct: pctChange(
        activeBusinesses,
        Math.max(activeBusinesses - businessesLast30, 0),
      ),
      usersChangePct: pctChange(usersLast30, usersPrev30),
      newUsersChangePct: pctChange(newUsersToday, newUsersYesterday),
      ordersChangePct: pctChange(
        newSubscriptionsToday,
        newSubscriptionsYesterday,
      ),
      revenueChangePct: 0,
    };
  }

  async getOverview(actor: User): Promise<PlatformAdminOverview> {
    this.assertSuperAdmin(actor);

    const [kpis, breakdownRows] = await Promise.all([
      this.computeKpis(),
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoin('sub.plan', 'plan')
        .select('plan.slug', 'planSlug')
        .addSelect('plan.name', 'planName')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `COALESCE(SUM(
            CASE
              WHEN sub.billing_cycle = 'annual'
                THEN COALESCE(plan."yearlyPrice", 0) * 100 / 12.0
              ELSE COALESCE(plan."monthlyPrice", 0) * 100
            END
          ), 0)`,
          'mrrCents',
        )
        .where('sub.status IN (:...statuses)', {
          statuses: ['active', 'trialing'],
        })
        .groupBy('plan.slug')
        .addGroupBy('plan.name')
        .orderBy('"mrrCents"', 'DESC')
        .getRawMany<{
          planSlug: string;
          planName: string;
          count: string;
          mrrCents: string;
        }>(),
    ]);

    const subscriptionBreakdown = breakdownRows.map((row) => ({
      planSlug: String(row.planSlug ?? 'unknown'),
      planName: String(row.planName ?? 'Unknown plan'),
      count: Number(row.count) || 0,
      mrrCents: Math.round(Number(row.mrrCents) || 0),
    }));

    return {
      kpis,
      charts: {
        revenueLast30Days: [],
        businessesLast30Days: [],
        subscriptionBreakdown,
      },
      businesses: [],
      users: [],
    };
  }
}

function normalizeDashboardPeriod(raw?: string): PlatformDashboardPeriod {
  const value = (raw ?? 'month').trim().toLowerCase();
  if (value === 'today' || value === 'week' || value === 'year') return value;
  return 'month';
}

function resolveDashboardWindow(
  period: PlatformDashboardPeriod,
  monthKeyRaw: string | undefined,
  timeZone: string,
): {
  from: Date;
  to: Date;
  label: string;
  priorFrom: Date;
  priorTo: Date;
  useMonthBuckets: boolean;
} {
  const now = new Date();
  const tz = resolveSafeTimeZone(timeZone);

  if (period === 'today') {
    const from = startOfDay(now);
    const to = now;
    const priorTo = new Date(from.getTime() - 1);
    const priorFrom = startOfDay(addDays(from, -1));
    return {
      from,
      to,
      label: 'Today',
      priorFrom,
      priorTo,
      useMonthBuckets: false,
    };
  }

  if (period === 'week') {
    const to = now;
    const from = addDays(startOfDay(now), -6);
    const priorTo = new Date(from.getTime() - 1);
    const priorFrom = addDays(startOfDay(priorTo), -6);
    return {
      from,
      to,
      label: 'This week',
      priorFrom,
      priorTo,
      useMonthBuckets: false,
    };
  }

  if (period === 'year') {
    const to = now;
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
    );
    const priorTo = new Date(from.getTime() - 1);
    const priorFrom = new Date(
      Date.UTC(priorTo.getUTCFullYear(), priorTo.getUTCMonth() - 11, 1),
    );
    return {
      from,
      to,
      label: String(now.getUTCFullYear()),
      priorFrom,
      priorTo,
      useMonthBuckets: true,
    };
  }

  const monthKey = (monthKeyRaw ?? '').trim();
  let year: number;
  let month: number;
  if (/^\d{4}-\d{2}$/.test(monthKey)) {
    year = Number(monthKey.slice(0, 4));
    month = Number(monthKey.slice(5, 7));
  } else {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    year = Number(parts.find((part) => part.type === 'year')?.value);
    month = Number(parts.find((part) => part.type === 'month')?.value);
  }

  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const clampedTo = to.getTime() > now.getTime() ? now : to;
  const priorFrom = new Date(Date.UTC(year, month - 2, 1, 0, 0, 0));
  const priorTo = new Date(Date.UTC(year, month - 1, 0, 23, 59, 59, 999));
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    'en-US',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  return {
    from,
    to: clampedTo,
    label,
    priorFrom,
    priorTo,
    useMonthBuckets: false,
  };
}

function buildMonthBucketKeys(from: Date, to: Date, timeZone: string): string[] {
  const tz = resolveSafeTimeZone(timeZone);
  const startParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(from);
  const endParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(to);
  let year = Number(startParts.find((part) => part.type === 'year')?.value);
  let month = Number(startParts.find((part) => part.type === 'month')?.value);
  const endYear = Number(endParts.find((part) => part.type === 'year')?.value);
  const endMonth = Number(endParts.find((part) => part.type === 'month')?.value);
  const keys: string[] = [];
  for (let guard = 0; guard < 36; guard += 1) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function formatDashboardBucketLabel(
  bucket: string,
  useMonthBuckets: boolean,
): string {
  if (useMonthBuckets && /^\d{4}-\d{2}$/.test(bucket)) {
    const [y, m] = bucket.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    });
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(bucket)) {
    const hour = Number(bucket.slice(11, 13));
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}${suffix}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    const day = Number(bucket.slice(8, 10));
    const month = Number(bucket.slice(5, 7));
    return new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString(
      'en-US',
      { month: 'short', day: 'numeric', timeZone: 'UTC' },
    );
  }
  return bucket;
}

function isFutureMeeting(row: MeetingRequest, now = Date.now()): boolean {
  if (!row.scheduledDate || !row.scheduledTime) return false;
  const zone = row.scheduledTimeZone?.trim() || 'UTC';
  const duration = row.scheduledDuration ?? 0;
  const end =
    duration > 0
      ? addMinutes(row.scheduledDate, row.scheduledTime, duration)
      : { date: row.scheduledDate, time: row.scheduledTime };
  try {
    return Date.parse(zonedDateTime(end.date, end.time, zone)) > now;
  } catch {
    return false;
  }
}

function isUpcomingMeeting(row: MeetingRequest, now = Date.now()): boolean {
  if (
    row.attendance === 'CANCELLED' ||
    row.attendance === 'NO_SHOW' ||
    row.attendance === 'ATTENDED'
  ) {
    return false;
  }
  return isFutureMeeting(row, now);
}
