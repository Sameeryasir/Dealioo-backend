import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { PlatformTwilioPhoneNumber } from '../../db/entities/platform-twilio-phone-number.entity';
import {
  SubscriptionPlan,
  type SubscriptionPlanDescription,
} from '../../db/entities/subscription-plan.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { CUSTOMER_ONBOARDING_STATUS } from '../customer-onboarding/customer-onboarding.constants';
import { BUSINESS_MEMBER_STATUS } from '../member/business-member-status';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from '../member/member.constants';
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
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt/jwt.strategy';
import { StripeService } from '../stripe/stripe.service';
import { TwilioService } from '../sms/twilio.service';
import { CreateAdminBusinessDto } from './dto/create-admin-business.dto';
import { CreateAdminPlanDto } from './dto/create-admin-plan.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { AssignAdminTwilioNumberDto } from './dto/assign-admin-twilio-number.dto';
import { PurchaseAdminTwilioNumberDto } from './dto/purchase-admin-twilio-number.dto';
import { SearchAdminTwilioNumbersDto } from './dto/search-admin-twilio-numbers.dto';
import { SetAdminTwilioWebhookDto } from './dto/set-admin-twilio-webhook.dto';
import { UnassignAdminTwilioNumberDto } from './dto/unassign-admin-twilio-number.dto';
import { UpdateAdminPlanDto } from './dto/update-admin-plan.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

export type AdminUsersTab =
  | 'active'
  | 'inactive'
  | 'managers'
  | 'staff'
  | 'scanners';

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
    active: number;
    inactive: number;
    managers: number;
    staff: number;
    scanners: number;
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
  /** False when browsing a past month/range — KPIs are activity in that range, not live totals. */
  isCurrentPeriod: boolean;
  kpis: {
    mrr: PlatformDashboardKpi;
    planEarnings: PlatformDashboardKpi;
    platformUsers: PlatformDashboardKpi;
    payingSubscriptions: PlatformDashboardKpi;
    newPlans: PlatformDashboardKpi;
    newUsers: PlatformDashboardKpi;
    activeBusinesses: PlatformDashboardKpi;
    onboardingCompletedPct: PlatformDashboardKpi;
    meetingsBooked: PlatformDashboardKpi;
    meetingsAttended: PlatformDashboardKpi;
    dealsWon: PlatformDashboardKpi;
    readyToCreate: PlatformDashboardKpi;
    conversionRate: PlatformDashboardKpi;
  };
  charts: {
    planEarnings: Array<{ label: string; value: number }>;
    subscriptions: Array<{ label: string; value: number }>;
    users: Array<{ label: string; value: number }>;
    businesses: Array<{ label: string; value: number }>;
    onboardingCompleted: Array<{ label: string; value: number }>;
    meetingsBooked: Array<{ label: string; value: number }>;
    meetingsAttended: Array<{ label: string; value: number }>;
    dealsWon: Array<{ label: string; value: number }>;
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
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(BusinessTwilioIntegration)
    private readonly businessTwilioIntegrationRepository: Repository<BusinessTwilioIntegration>,
    @InjectRepository(PlatformTwilioPhoneNumber)
    private readonly platformTwilioPhoneNumberRepository: Repository<PlatformTwilioPhoneNumber>,
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
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
    private readonly jwtStrategy: JwtStrategy,
    private readonly authService: AuthService,
    private readonly stripeService: StripeService,
    private readonly twilioService: TwilioService,
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
          targetId: input.targetId == null ? null : String(input.targetId),
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
  ): Promise<
    Map<number, PlatformAdminOverview['users'][number]['businesses']>
  > {
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
      selectedPlanSlug: string | null;
      selectedPlanName: string | null;
      selectedBillingCycle: string | null;
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
            row.selectedPlanName,
            row.selectedPlanSlug,
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
          selectedPlanSlug: row.selectedPlanSlug,
          selectedPlanName: row.selectedPlanName,
          selectedBillingCycle: row.selectedBillingCycle,
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
      'selectedPlan',
      'selectedPlanSlug',
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
        row.selectedPlanName ?? '',
        row.selectedPlanSlug ?? '',
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

    const todayKey = calendarDateInTimeZone(new Date(), chartTz);
    const day30Ago = startOfCalendarDayInTimeZone(
      shiftCalendarDateKey(todayKey, -29),
      chartTz,
    );
    const day60Ago = startOfCalendarDayInTimeZone(
      shiftCalendarDateKey(todayKey, -59),
      chartTz,
    );

    const [
      trendCurrent,
      trendPrior,
      mrrNow,
      mrrAtPeriodStart,
      totalUsers,
      usersLast30,
      usersPrev30,
      countryCounts,
      growthStats,
      salesCurrent,
      salesPrior,
      salesTrend,
      onboardingTrend,
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
        .where('b.deleted_at IS NULL')
        .groupBy('b.country')
        .getRawMany<{ country: string | null; count: string }>(),
      this.computeGrowthSnapshotStats(from, to, priorFrom, priorTo),
      this.computeSalesPipelineStats(from, to),
      this.computeSalesPipelineStats(priorFrom, priorTo),
      this.computeSalesTrendWindow(from, to, chartTz, useMonthBuckets).catch(
        (error) => {
          this.logger.warn(
            `Sales trend window failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [] as Array<{
            bucket: string;
            booked: number;
            attended: number;
            dealsWon: number;
          }>;
        },
      ),
      this.computeOnboardingTrendWindow(
        from,
        to,
        chartTz,
        useMonthBuckets,
      ).catch((error) => {
        this.logger.warn(
          `Onboarding trend window failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as Array<{ bucket: string; count: number }>;
      }),
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
    const businessSpark = spark(
      trendCurrent.points.map((point) => point.businesses),
    );

    const chartLabel = (bucket: string) =>
      formatDashboardBucketLabel(bucket, useMonthBuckets);

    // Past months must not show today's live MRR / paying totals.
    const isCurrentPeriod = to.getTime() >= Date.now() - 2 * 60_000;

    return {
      period,
      label,
      from: from.toISOString(),
      to: to.toISOString(),
      isCurrentPeriod,
      kpis: {
        mrr: isCurrentPeriod
          ? {
              value: mrrNow.mrrCents,
              changePct: pctChange(mrrNow.mrrCents, mrrAtPeriodStart.mrrCents),
              sparkline: earningsSpark,
              hint: 'Current monthly recurring income',
            }
          : {
              value: trendCurrent.totalRevenueCents,
              changePct: pctChange(
                trendCurrent.totalRevenueCents,
                trendPrior.totalRevenueCents,
              ),
              sparkline: earningsSpark,
              hint: `${label} · income from new subscriptions`,
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
          value: isCurrentPeriod ? totalUsers : trendCurrent.newUsers,
          changePct: isCurrentPeriod
            ? pctChange(usersLast30, usersPrev30)
            : pctChange(trendCurrent.newUsers, trendPrior.newUsers),
          sparkline: usersSpark,
          hint: isCurrentPeriod
            ? 'All accounts · vs prior 30 days'
            : `${label} · accounts created`,
        },
        payingSubscriptions: isCurrentPeriod
          ? {
              value: mrrNow.payingCount,
              changePct: pctChange(
                mrrNow.payingCount,
                mrrAtPeriodStart.payingCount,
              ),
              sparkline: subsSpark,
              hint: 'Currently paying plans',
            }
          : {
              value: trendCurrent.newSubscriptions,
              changePct: pctChange(
                trendCurrent.newSubscriptions,
                trendPrior.newSubscriptions,
              ),
              sparkline: subsSpark,
              hint: `${label} · new subscriptions`,
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
        newUsers: {
          value: trendCurrent.newUsers,
          changePct: pctChange(trendCurrent.newUsers, trendPrior.newUsers),
          sparkline: usersSpark,
          hint: `${label} · accounts created`,
        },
        activeBusinesses: {
          value: isCurrentPeriod
            ? growthStats.activeBusinesses
            : trendCurrent.newBusinesses,
          changePct: pctChange(
            trendCurrent.newBusinesses,
            trendPrior.newBusinesses,
          ),
          sparkline: businessSpark,
          hint: isCurrentPeriod
            ? 'Live tenants now'
            : `${label} · new businesses`,
        },
        onboardingCompletedPct: {
          value: isCurrentPeriod
            ? growthStats.onboardingCompletedPct
            : growthStats.completedThisPeriod,
          changePct: pctChange(
            growthStats.completedThisPeriod,
            growthStats.completedPriorPeriod,
          ),
          sparkline: businessSpark,
          hint: isCurrentPeriod
            ? 'Share of businesses that finished setup'
            : `${label} · setup completions`,
        },
        meetingsBooked: {
          value: salesCurrent.booked,
          changePct: pctChange(salesCurrent.booked, salesPrior.booked),
          sparkline: [salesPrior.booked, salesCurrent.booked],
          hint: `${label} · meetings created`,
        },
        meetingsAttended: {
          value: salesCurrent.attended,
          changePct: pctChange(salesCurrent.attended, salesPrior.attended),
          sparkline: [salesPrior.attended, salesCurrent.attended],
          hint: `${label} · marked attended`,
        },
        dealsWon: {
          value: salesCurrent.dealsWon,
          changePct: pctChange(salesCurrent.dealsWon, salesPrior.dealsWon),
          sparkline: [salesPrior.dealsWon, salesCurrent.dealsWon],
          hint: `${label} · closed sales`,
        },
        readyToCreate: {
          value: salesCurrent.readyToCreate,
          changePct: 0,
          sparkline: [salesCurrent.readyToCreate],
          hint: isCurrentPeriod
            ? 'Won deals waiting for an account'
            : 'Current backlog (not limited to this month)',
        },
        conversionRate: {
          value: salesCurrent.conversionRate,
          changePct: pctChange(
            salesCurrent.conversionRate,
            salesPrior.conversionRate,
          ),
          sparkline: [salesPrior.conversionRate, salesCurrent.conversionRate],
          hint: `${label} · attended → deal won`,
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
        onboardingCompleted: onboardingTrend.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.count,
        })),
        meetingsBooked: salesTrend.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.booked,
        })),
        meetingsAttended: salesTrend.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.attended,
        })),
        dealsWon: salesTrend.map((point) => ({
          label: chartLabel(point.bucket),
          value: point.dealsWon,
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

  private async computeGrowthSnapshotStats(
    from: Date,
    to: Date,
    priorFrom: Date,
    priorTo: Date,
  ): Promise<{
    activeBusinesses: number;
    onboardingCompletedPct: number;
    completedThisPeriod: number;
    completedPriorPeriod: number;
  }> {
    const [
      activeBusinesses,
      completedBusinesses,
      completedThisPeriod,
      completedPriorPeriod,
    ] = await Promise.all([
      this.businessRepository
        .createQueryBuilder('b')
        .where('b.deleted_at IS NULL')
        .getCount(),
      this.businessRepository
        .createQueryBuilder('b')
        .where('b.deleted_at IS NULL')
        .andWhere('b.onboarding_completed = true')
        .getCount(),
      this.businessRepository
        .createQueryBuilder('b')
        .where('b.deleted_at IS NULL')
        .andWhere('b.onboarding_completed_at >= :from', { from })
        .andWhere('b.onboarding_completed_at <= :to', { to })
        .getCount(),
      this.businessRepository
        .createQueryBuilder('b')
        .where('b.deleted_at IS NULL')
        .andWhere('b.onboarding_completed_at >= :from', { from: priorFrom })
        .andWhere('b.onboarding_completed_at <= :to', { to: priorTo })
        .getCount(),
    ]);

    const onboardingCompletedPct =
      activeBusinesses > 0
        ? Math.round((completedBusinesses / activeBusinesses) * 1000) / 10
        : 0;

    return {
      activeBusinesses,
      onboardingCompletedPct,
      completedThisPeriod,
      completedPriorPeriod,
    };
  }

  private async computeOnboardingTrendWindow(
    from: Date,
    to: Date,
    chartTz: string,
    useMonthBuckets: boolean,
  ): Promise<Array<{ bucket: string; count: number }>> {
    let keys: string[];
    let bucketExpr: string;

    if (useMonthBuckets) {
      keys = buildMonthBucketKeys(from, to, chartTz);
      const tz = chartTz.replace(/'/g, "''");
      bucketExpr = `TO_CHAR(DATE_TRUNC('month', b.onboarding_completed_at AT TIME ZONE '${tz}'), 'YYYY-MM')`;
    } else {
      const built = buildZonedRangeBucketKeys(from, to, chartTz);
      keys = built.keys;
      bucketExpr = overviewRangeBucketSql(
        'b.onboarding_completed_at',
        built.sameDay,
        chartTz,
      );
    }

    const rows = await this.businessRepository
      .createQueryBuilder('b')
      .select(bucketExpr, 'bucket')
      .addSelect('COUNT(*)', 'count')
      .where('b.deleted_at IS NULL')
      .andWhere('b.onboarding_completed_at IS NOT NULL')
      .andWhere('b.onboarding_completed_at >= :from', { from })
      .andWhere('b.onboarding_completed_at <= :to', { to })
      .groupBy(bucketExpr)
      .getRawMany<{ bucket: string; count: string }>();

    const countMap = new Map(
      rows.map((row) => [String(row.bucket ?? ''), Number(row.count) || 0]),
    );

    return keys.map((bucket) => ({
      bucket,
      count: countMap.get(bucket) ?? 0,
    }));
  }

  private async computeSalesTrendWindow(
    from: Date,
    to: Date,
    chartTz: string,
    useMonthBuckets: boolean,
  ): Promise<
    Array<{
      bucket: string;
      booked: number;
      attended: number;
      dealsWon: number;
    }>
  > {
    const outcomeAt = 'COALESCE(m.outcome_updated_at, m.created_at)';
    let keys: string[];
    let bookedBucket: string;
    let outcomeBucket: string;

    if (useMonthBuckets) {
      keys = buildMonthBucketKeys(from, to, chartTz);
      const tz = chartTz.replace(/'/g, "''");
      bookedBucket = `TO_CHAR(DATE_TRUNC('month', m.created_at AT TIME ZONE '${tz}'), 'YYYY-MM')`;
      outcomeBucket = `TO_CHAR(DATE_TRUNC('month', ${outcomeAt} AT TIME ZONE '${tz}'), 'YYYY-MM')`;
    } else {
      const built = buildZonedRangeBucketKeys(from, to, chartTz);
      keys = built.keys;
      bookedBucket = overviewRangeBucketSql(
        'm.created_at',
        built.sameDay,
        chartTz,
      );
      outcomeBucket = overviewRangeBucketSql(outcomeAt, built.sameDay, chartTz);
    }

    const [bookedRows, attendedRows, wonRows] = await Promise.all([
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .select(bookedBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('m.created_at >= :from', { from })
        .andWhere('m.created_at <= :to', { to })
        .groupBy(bookedBucket)
        .getRawMany<{ bucket: string; count: string }>(),
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .select(outcomeBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('m.attendance = :attendance', { attendance: 'ATTENDED' })
        .andWhere(`${outcomeAt} >= :from`, { from })
        .andWhere(`${outcomeAt} <= :to`, { to })
        .groupBy(outcomeBucket)
        .getRawMany<{ bucket: string; count: string }>(),
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .select(outcomeBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('m.attendance = :attendance', { attendance: 'ATTENDED' })
        .andWhere('m.sales_outcome = :outcome', { outcome: 'DEAL_WON' })
        .andWhere(`${outcomeAt} >= :from`, { from })
        .andWhere(`${outcomeAt} <= :to`, { to })
        .groupBy(outcomeBucket)
        .getRawMany<{ bucket: string; count: string }>(),
    ]);

    const bookedMap = new Map(
      bookedRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const attendedMap = new Map(
      attendedRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.count) || 0,
      ]),
    );
    const wonMap = new Map(
      wonRows.map((row) => [String(row.bucket ?? ''), Number(row.count) || 0]),
    );

    return keys.map((bucket) => ({
      bucket,
      booked: bookedMap.get(bucket) ?? 0,
      attended: attendedMap.get(bucket) ?? 0,
      dealsWon: wonMap.get(bucket) ?? 0,
    }));
  }

  private async computeSalesPipelineStats(
    from: Date,
    to: Date,
  ): Promise<{
    booked: number;
    attended: number;
    dealsWon: number;
    readyToCreate: number;
    conversionRate: number;
  }> {
    const outcomeAt = 'COALESCE(m.outcome_updated_at, m.created_at)';

    const [booked, attended, dealsWon, readyToCreate] = await Promise.all([
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .where('m.created_at >= :from', { from })
        .andWhere('m.created_at <= :to', { to })
        .getCount(),
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .where('m.attendance = :attendance', { attendance: 'ATTENDED' })
        .andWhere(`${outcomeAt} >= :from`, { from })
        .andWhere(`${outcomeAt} <= :to`, { to })
        .getCount(),
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .where('m.attendance = :attendance', { attendance: 'ATTENDED' })
        .andWhere('m.sales_outcome = :outcome', { outcome: 'DEAL_WON' })
        .andWhere(`${outcomeAt} >= :from`, { from })
        .andWhere(`${outcomeAt} <= :to`, { to })
        .getCount(),
      this.meetingRequestRepository
        .createQueryBuilder('m')
        .where('m.attendance = :attendance', { attendance: 'ATTENDED' })
        .andWhere('m.sales_outcome = :outcome', { outcome: 'DEAL_WON' })
        .andWhere(
          `NOT EXISTS (
            SELECT 1
            FROM customer_onboardings o
            WHERE o.meeting_id = m.id
              AND o.business_id IS NOT NULL
          )`,
        )
        .getCount(),
    ]);

    const conversionRate =
      attended > 0 ? Math.round((dealsWon / attended) * 1000) / 10 : 0;

    return {
      booked,
      attended,
      dealsWon,
      readyToCreate,
      conversionRate,
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
    const value = (raw ?? 'active').trim().toLowerCase();
    if (
      value === 'active' ||
      value === 'inactive' ||
      value === 'managers' ||
      value === 'staff' ||
      value === 'scanners' ||
      value === 'scanner'
    ) {
      return value === 'scanner' ? 'scanners' : value;
    }
    return 'active';
  }

  private parseUsersSort(raw?: string): AdminUsersSort {
    const value = (raw ?? 'newest').trim().toLowerCase();
    if (value === 'oldest' || value === 'name_asc' || value === 'name_desc') {
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
    } else if (tab === 'managers') {
      qb.andWhere(this.usersWithBusinessRolesSql, {
        bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        bmRoles: ['Manager'],
      });
    } else if (tab === 'staff') {
      qb.andWhere(this.usersWithBusinessRolesSql, {
        bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        bmRoles: ['Staff'],
      });
    } else if (tab === 'scanners') {
      qb.andWhere(this.usersWithBusinessRolesSql, {
        bmStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
        bmRoles: ['Scanner'],
      });
    }
  }

  private async buildUsersSummary(actorId: number): Promise<AdminUsersSummary> {
    const now = new Date();
    const last30Start = addDays(startOfDay(now), -29);
    const prev30Start = addDays(last30Start, -30);
    const bmStatus = BUSINESS_MEMBER_STATUS.ACTIVE;

    const [core, roleTabs] = await Promise.all([
      this.userRepository
        .createQueryBuilder('u')
        .select('COUNT(*)', 'total')
        .addSelect(
          'SUM(CASE WHEN u.isActive = true THEN 1 ELSE 0 END)',
          'active',
        )
        .addSelect(
          'SUM(CASE WHEN u.isActive = false THEN 1 ELSE 0 END)',
          'inactive',
        )
        .addSelect(
          'SUM(CASE WHEN u.createdAt >= :last30Start THEN 1 ELSE 0 END)',
          'newUsers',
        )
        .addSelect(
          `SUM(CASE WHEN u.createdAt >= :prev30Start AND u.createdAt < :last30Start THEN 1 ELSE 0 END)`,
          'prevNewUsers',
        )
        .addSelect(
          'SUM(CASE WHEN u.createdAt < :last30Start THEN 1 ELSE 0 END)',
          'totalPrev',
        )
        .where('u.id != :actorId', { actorId })
        .setParameters({ last30Start, prev30Start })
        .getRawOne<{
          total: string;
          active: string;
          inactive: string;
          newUsers: string;
          prevNewUsers: string;
          totalPrev: string;
        }>(),
      this.userRepository
        .createQueryBuilder('u')
        .select(
          `SUM(CASE WHEN EXISTS (
            SELECT 1 FROM business_members bm
            WHERE bm.user_id = u.id
              AND bm.status = :bmStatus
              AND bm.role = 'Manager'
          ) THEN 1 ELSE 0 END)`,
          'managers',
        )
        .addSelect(
          `SUM(CASE WHEN EXISTS (
            SELECT 1 FROM business_members bm
            WHERE bm.user_id = u.id
              AND bm.status = :bmStatus
              AND bm.role = 'Staff'
          ) THEN 1 ELSE 0 END)`,
          'staff',
        )
        .addSelect(
          `SUM(CASE WHEN EXISTS (
            SELECT 1 FROM business_members bm
            WHERE bm.user_id = u.id
              AND bm.status = :bmStatus
              AND bm.role = 'Scanner'
          ) THEN 1 ELSE 0 END)`,
          'scanners',
        )
        .where('u.id != :actorId', { actorId })
        .setParameters({ bmStatus })
        .getRawOne<{
          managers: string;
          staff: string;
          scanners: string;
        }>(),
    ]);

    const total = Number(core?.total) || 0;
    const active = Number(core?.active) || 0;
    const inactive = Number(core?.inactive) || 0;
    const newUsers = Number(core?.newUsers) || 0;
    const prevNewUsers = Number(core?.prevNewUsers) || 0;
    const totalPrev = Number(core?.totalPrev) || 0;
    const managers = Number(roleTabs?.managers) || 0;
    const staff = Number(roleTabs?.staff) || 0;
    const scanners = Number(roleTabs?.scanners) || 0;

    const totalChangePct = pctChange(total, totalPrev);
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
        active,
        inactive,
        managers,
        staff,
        scanners,
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
    if (isSuperAdminRole(roleName) && dto.confirmElevateToSuperAdmin !== true) {
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
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const created = this.userRepository.create({
      name: fullName,
      firstName,
      lastName,
      email,
      phone: phone.length > 0 ? phone : null,
      passwordHash: null,
      role,
      createdBy: actor,
      isActive: true,
      emailVerified: true,
      provider: 'LOCAL',
    });
    const saved = await this.userRepository.save(created);

    let passwordSetupEmailSent = false;
    try {
      await this.authService.sendSetPasswordSetupEmail(saved);
      passwordSetupEmailSent = true;
    } catch (error) {
      this.logger.error(
        `Failed to send set-password email for user ${saved.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'user.create',
      targetType: 'user',
      targetId: saved.id,
      metadata: {
        email: saved.email,
        roleName,
        elevatedToSuperAdmin: isSuperAdminRole(roleName),
        passwordSetupEmailSent,
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
        throw new BadRequestException(
          'You cannot deactivate your own account.',
        );
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

    const metaStatus = (business.metaConnectionStatus ?? '')
      .trim()
      .toUpperCase();
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

  private async upsertPlatformTwilioNumber(input: {
    phoneSid: string;
    phoneNumber: string;
    friendlyName?: string | null;
    status?: string | null;
    addressRequirement?: string | null;
    dateCreated?: string | Date | null;
    webhookUrl?: string | null;
    webhookConfigured?: boolean;
    capabilities?: {
      sms?: boolean;
      mms?: boolean;
      voice?: boolean;
      fax?: boolean;
    };
    businessId?: number | null;
    connectedAt?: Date | null;
  }): Promise<PlatformTwilioPhoneNumber> {
    const phoneSid = input.phoneSid.trim();
    const phoneNumber = input.phoneNumber.trim();
    let row =
      (await this.platformTwilioPhoneNumberRepository.findOne({
        where: { phoneSid },
      })) ||
      (await this.platformTwilioPhoneNumberRepository.findOne({
        where: { phoneNumber },
      }));

    if (!row) {
      row = this.platformTwilioPhoneNumberRepository.create({
        phoneSid,
        phoneNumber,
      });
    }

    row.phoneSid = phoneSid;
    row.phoneNumber = phoneNumber;
    if (input.friendlyName !== undefined) {
      row.friendlyName = input.friendlyName?.trim() || null;
    }
    if (input.status !== undefined) {
      row.status = input.status?.trim() || null;
    }
    if (input.addressRequirement !== undefined) {
      row.addressRequirement = input.addressRequirement?.trim() || null;
    }
    if (input.dateCreated !== undefined) {
      row.dateCreated = input.dateCreated ? new Date(input.dateCreated) : null;
    }
    if (input.webhookUrl !== undefined) {
      row.webhookUrl = input.webhookUrl?.trim() || null;
      row.webhookConfigured =
        input.webhookConfigured ?? Boolean(row.webhookUrl);
    } else if (input.webhookConfigured !== undefined) {
      row.webhookConfigured = input.webhookConfigured;
    }
    if (input.capabilities) {
      row.capSms = Boolean(input.capabilities.sms);
      row.capMms = Boolean(input.capabilities.mms);
      row.capVoice = Boolean(input.capabilities.voice);
      row.capFax = Boolean(input.capabilities.fax);
    }
    if (input.businessId !== undefined) {
      row.businessId = input.businessId;
    }
    if (input.connectedAt !== undefined) {
      row.connectedAt = input.connectedAt;
    }
    row.lastSyncedAt = new Date();
    return this.platformTwilioPhoneNumberRepository.save(row);
  }

  private async syncPlatformTwilioNumbersFromTwilio(): Promise<void> {
    const platform = this.twilioService.requirePlatformCredentials();
    const remote =
      await this.twilioService.listAllIncomingPhoneNumbersDetailed(platform);

    const connectedBusinesses = await this.businessRepository
      .createQueryBuilder('b')
      .select([
        'b.id',
        'b.name',
        'b.twilioPhoneSid',
        'b.twilioPhoneNumber',
        'b.twilioConnectedAt',
      ])
      .where('b.twilioPhoneSid IS NOT NULL')
      .andWhere("TRIM(b.twilioPhoneSid) <> ''")
      .andWhere('b.twilioPhoneNumber IS NOT NULL')
      .andWhere("TRIM(b.twilioPhoneNumber) <> ''")
      .getMany();

    const bySid = new Map(
      connectedBusinesses
        .filter((b) => b.twilioPhoneSid?.trim())
        .map((b) => [b.twilioPhoneSid!.trim(), b]),
    );
    const byNumber = new Map(
      connectedBusinesses
        .filter((b) => b.twilioPhoneNumber?.trim())
        .map((b) => [b.twilioPhoneNumber!.trim(), b]),
    );

    const seenSids = new Set<string>();
    for (const number of remote) {
      seenSids.add(number.sid);
      const assigned =
        bySid.get(number.sid) || byNumber.get(number.phoneNumber) || null;
      await this.upsertPlatformTwilioNumber({
        phoneSid: number.sid,
        phoneNumber: number.phoneNumber,
        friendlyName: number.friendlyName,
        status: number.status,
        addressRequirement: number.addressRequirement,
        dateCreated: number.dateCreated,
        webhookUrl: number.webhookUrl,
        webhookConfigured: number.webhookConfigured,
        capabilities: number.capabilities,
        businessId: assigned?.id ?? null,
        connectedAt: assigned?.twilioConnectedAt ?? null,
      });
    }

    if (seenSids.size > 0) {
      const stale = await this.platformTwilioPhoneNumberRepository.find({
        select: ['id', 'phoneSid'],
      });
      const staleIds = stale
        .filter((row) => !seenSids.has(row.phoneSid))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await this.platformTwilioPhoneNumberRepository.delete(staleIds);
      }
    }
  }

  async getTwilioDashboard(
    actor: User,
    options?: { page?: number; limit?: number; sync?: boolean },
  ) {
    this.assertSuperAdmin(actor);

    const { page, limit } = normalizePagination(options?.page, options?.limit);
    const safeLimit = Math.min(50, limit);

    const existingCount =
      await this.platformTwilioPhoneNumberRepository.count();
    const newestInventorySync = await this.platformTwilioPhoneNumberRepository
      .createQueryBuilder('n')
      .select('MAX(n.lastSyncedAt)', 'max')
      .getRawOne<{ max: Date | string | null }>();
    const newestSyncAt = newestInventorySync?.max
      ? new Date(newestInventorySync.max).getTime()
      : 0;
    const inventoryStale =
      !newestSyncAt || Date.now() - newestSyncAt > 60 * 60 * 1000;
    const shouldSyncInventory =
      Boolean(options?.sync) || existingCount === 0 || inventoryStale;

    if (shouldSyncInventory) {
      try {
        await this.syncPlatformTwilioNumbersFromTwilio();
      } catch (error) {
        if (existingCount === 0) {
          const summary = await this.twilioService.getPlatformAccountSummary();
          return {
            configured: summary.configured,
            accountOwnerName: summary.accountOwnerName,
            defaultWebhookUrl: summary.defaultWebhookUrl,
            balance: summary.balance,
            numbers: [],
            counts: {
              phoneNumbers: 0,
              assigned: 0,
              unassigned: 0,
            },
            meta: buildPaginationMeta(0, page, safeLimit),
            error:
              summary.error ||
              (error instanceof Error
                ? error.message
                : 'Could not sync Twilio numbers.'),
          };
        }
      }
    }

    const [summary, total, assignedCount, rows] = await Promise.all([
      this.twilioService.getPlatformAccountSummary(),
      this.platformTwilioPhoneNumberRepository.count(),
      this.platformTwilioPhoneNumberRepository
        .createQueryBuilder('n')
        .where('n.businessId IS NOT NULL')
        .getCount(),
      this.platformTwilioPhoneNumberRepository
        .createQueryBuilder('n')
        .leftJoinAndSelect('n.business', 'business')
        .orderBy('n.dateCreated', 'DESC', 'NULLS LAST')
        .addOrderBy('n.id', 'DESC')
        .skip((page - 1) * safeLimit)
        .take(safeLimit)
        .getMany(),
    ]);

    const numbers = rows.map((row) => ({
      phoneNumber: row.phoneNumber,
      label: row.friendlyName,
      status: row.status,
      addressRequirement: row.addressRequirement,
      dateCreated: row.dateCreated
        ? new Date(row.dateCreated).toISOString()
        : null,
      webhookUrl: row.webhookUrl,
      webhookConfigured: row.webhookConfigured,
      capabilities: {
        sms: row.capSms,
        mms: row.capMms,
        voice: row.capVoice,
        fax: row.capFax,
      },
      businessName: row.business?.name?.trim() || null,
      connectedAt: row.connectedAt
        ? new Date(row.connectedAt).toISOString()
        : null,
    }));

    return {
      configured: summary.configured,
      accountOwnerName: summary.accountOwnerName,
      defaultWebhookUrl: summary.defaultWebhookUrl,
      balance: summary.balance,
      numbers,
      counts: {
        phoneNumbers: total,
        assigned: assignedCount,
        unassigned: Math.max(0, total - assignedCount),
      },
      meta: buildPaginationMeta(total, page, safeLimit),
      error: summary.error,
    };
  }

  async searchTwilioAvailableNumbers(
    actor: User,
    dto: SearchAdminTwilioNumbersDto,
  ) {
    this.assertSuperAdmin(actor);
    const platform = this.twilioService.requirePlatformCredentials();
    const numbers = await this.twilioService.searchAvailablePhoneNumbers({
      accountSid: platform.accountSid,
      authToken: platform.authToken,
      countryCode: dto.country?.trim() || dto.countryCode,
      areaCode: dto.areaCode,
      areaName: dto.areaName,
      contains: dto.contains,
      voice: dto.voice,
      sms: dto.sms ?? true,
      limit: dto.limit,
    });
    return { numbers };
  }

  async purchaseTwilioNumber(actor: User, dto: PurchaseAdminTwilioNumberDto) {
    this.assertSuperAdmin(actor);
    const platform = this.twilioService.requirePlatformCredentials();
    this.twilioService.assertInboundSmsConfigured();

    const purchased = await this.twilioService.purchasePhoneNumber({
      accountSid: platform.accountSid,
      authToken: platform.authToken,
      phoneNumber: dto.phoneNumber,
    });

    const webhook = await this.twilioService.syncInboundWebhookForNumber({
      accountSid: platform.accountSid,
      authToken: platform.authToken,
      phoneSid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
    });

    let assignedBusiness: {
      id: number;
      name: string;
      twilioConnectedAt: Date;
    } | null = null;

    if (dto.businessId != null) {
      const business = await this.businessRepository.findOne({
        where: { id: dto.businessId },
      });
      if (!business) {
        throw new NotFoundException('Business not found.');
      }

      const connectedAt = new Date();
      business.twilioPhoneSid = purchased.sid;
      business.twilioPhoneNumber = purchased.phoneNumber;
      business.twilioConnectedAt = connectedAt;
      await this.businessRepository.save(business);

      let integration = await this.businessTwilioIntegrationRepository.findOne({
        where: { businessId: business.id },
      });
      if (!integration) {
        integration = this.businessTwilioIntegrationRepository.create({
          businessId: business.id,
        });
      }
      integration.twilioPhoneSid = purchased.sid;
      integration.twilioPhoneNumber = purchased.phoneNumber;
      integration.twilioConnectedAt = connectedAt;
      await this.businessTwilioIntegrationRepository.save(integration);

      assignedBusiness = {
        id: business.id,
        name: business.name,
        twilioConnectedAt: connectedAt,
      };
    }

    await this.upsertPlatformTwilioNumber({
      phoneSid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      webhookUrl: webhook.smsUrl,
      webhookConfigured: Boolean(webhook.smsUrl),
      businessId: assignedBusiness?.id ?? null,
      connectedAt: assignedBusiness?.twilioConnectedAt ?? null,
      dateCreated: new Date(),
    });

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'twilio_number_purchased',
      targetType: 'twilio_phone_number',
      targetId: purchased.phoneNumber,
      metadata: {
        phoneNumber: purchased.phoneNumber,
        businessId: assignedBusiness?.id ?? null,
      },
    });

    return {
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      assignedBusiness: assignedBusiness
        ? { name: assignedBusiness.name }
        : null,
    };
  }

  async setTwilioWebhook(actor: User, dto: SetAdminTwilioWebhookDto) {
    this.assertSuperAdmin(actor);
    const platform = this.twilioService.requirePlatformCredentials();
    const phoneNumber = dto.phoneNumber.trim();
    const smsUrl = dto.smsUrl?.trim() || undefined;

    const cached = await this.platformTwilioPhoneNumberRepository.findOne({
      where: { phoneNumber },
    });
    const match = cached?.phoneSid
      ? { sid: cached.phoneSid, phoneNumber: cached.phoneNumber }
      : await this.twilioService.findIncomingPhoneNumberByPhone({
          accountSid: platform.accountSid,
          authToken: platform.authToken,
          phoneNumber,
        });
    if (!match?.sid) {
      throw new NotFoundException(
        'That phone number was not found on the Twilio account.',
      );
    }

    const result = await this.twilioService.syncInboundWebhookForNumber({
      accountSid: platform.accountSid,
      authToken: platform.authToken,
      phoneSid: match.sid,
      phoneNumber,
      smsUrl,
    });

    await this.upsertPlatformTwilioNumber({
      phoneSid: match.sid,
      phoneNumber,
      webhookUrl: result.smsUrl,
      webhookConfigured: Boolean(result.smsUrl),
    });

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'twilio_webhook_set',
      targetType: 'twilio_phone_number',
      targetId: phoneNumber,
      metadata: {
        phoneNumber,
        webhookHost: (() => {
          try {
            return new URL(result.smsUrl).host;
          } catch {
            return null;
          }
        })(),
      },
    });

    return {
      phoneNumber,
      webhookUrl: result.smsUrl,
      ok: true,
    };
  }

  async syncAllTwilioWebhooks(actor: User) {
    this.assertSuperAdmin(actor);
    const platform = this.twilioService.requirePlatformCredentials();
    this.twilioService.assertInboundSmsConfigured();

    let owned = await this.platformTwilioPhoneNumberRepository.find({
      select: ['phoneSid', 'phoneNumber'],
      order: { id: 'ASC' },
    });
    if (owned.length === 0) {
      await this.syncPlatformTwilioNumbersFromTwilio();
      owned = await this.platformTwilioPhoneNumberRepository.find({
        select: ['phoneSid', 'phoneNumber'],
        order: { id: 'ASC' },
      });
    }

    const results: Array<{
      phoneNumber: string;
      ok: boolean;
      error: string | null;
    }> = [];

    for (const number of owned) {
      try {
        const result = await this.twilioService.syncInboundWebhookForNumber({
          accountSid: platform.accountSid,
          authToken: platform.authToken,
          phoneSid: number.phoneSid,
          phoneNumber: number.phoneNumber,
        });
        await this.upsertPlatformTwilioNumber({
          phoneSid: number.phoneSid,
          phoneNumber: number.phoneNumber,
          webhookUrl: result.smsUrl,
          webhookConfigured: Boolean(result.smsUrl),
        });
        results.push({
          phoneNumber: number.phoneNumber,
          ok: true,
          error: null,
        });
      } catch {
        results.push({
          phoneNumber: number.phoneNumber,
          ok: false,
          error: 'Webhook sync failed for this number.',
        });
      }
    }

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'twilio_webhook_sync_all',
      targetType: 'twilio_account',
      targetId: 'platform',
      metadata: {
        total: results.length,
        ok: results.filter((item) => item.ok).length,
      },
    });

    return {
      total: results.length,
      ok: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }

  async assignTwilioNumber(actor: User, dto: AssignAdminTwilioNumberDto) {
    this.assertSuperAdmin(actor);
    const platform = this.twilioService.requirePlatformCredentials();
    this.twilioService.assertInboundSmsConfigured();

    const business = await this.businessRepository.findOne({
      where: { id: dto.businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const phoneNumber = dto.phoneNumber.trim();
    const phoneSid = dto.phoneSid?.trim() || '';

    let match: { sid: string; phoneNumber: string } | null = null;
    if (phoneSid) {
      const cachedBySid =
        await this.platformTwilioPhoneNumberRepository.findOne({
          where: { phoneSid },
        });
      if (cachedBySid) {
        match = {
          sid: cachedBySid.phoneSid,
          phoneNumber: cachedBySid.phoneNumber,
        };
      }
    }
    if (!match) {
      const cachedByNumber =
        await this.platformTwilioPhoneNumberRepository.findOne({
          where: { phoneNumber },
        });
      if (cachedByNumber) {
        match = {
          sid: cachedByNumber.phoneSid,
          phoneNumber: cachedByNumber.phoneNumber,
        };
      }
    }
    if (!match) {
      const remote = await this.twilioService.findIncomingPhoneNumberByPhone({
        accountSid: platform.accountSid,
        authToken: platform.authToken,
        phoneNumber,
      });
      if (remote) {
        match = { sid: remote.sid, phoneNumber: remote.phoneNumber };
      }
    }
    if (!match) {
      throw new BadRequestException(
        'That phone number is not on the Dealioo Twilio account.',
      );
    }

    const connectedAt = new Date();
    business.twilioPhoneSid = match.sid;
    business.twilioPhoneNumber = match.phoneNumber;
    business.twilioConnectedAt = connectedAt;
    await this.businessRepository.save(business);

    let integration = await this.businessTwilioIntegrationRepository.findOne({
      where: { businessId: business.id },
    });
    if (!integration) {
      integration = this.businessTwilioIntegrationRepository.create({
        businessId: business.id,
      });
    }
    integration.twilioPhoneSid = match.sid;
    integration.twilioPhoneNumber = match.phoneNumber;
    integration.twilioConnectedAt = connectedAt;
    await this.businessTwilioIntegrationRepository.save(integration);

    const webhook = await this.twilioService.syncInboundWebhookForNumber({
      accountSid: platform.accountSid,
      authToken: platform.authToken,
      phoneSid: match.sid,
      phoneNumber: match.phoneNumber,
    });

    await this.upsertPlatformTwilioNumber({
      phoneSid: match.sid,
      phoneNumber: match.phoneNumber,
      webhookUrl: webhook.smsUrl,
      webhookConfigured: Boolean(webhook.smsUrl),
      businessId: business.id,
      connectedAt,
    });

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'twilio_number_assigned',
      targetType: 'business',
      targetId: business.id,
      metadata: {
        phoneNumber: match.phoneNumber,
      },
    });

    return {
      businessId: business.id,
      businessName: business.name,
      twilioPhoneNumber: match.phoneNumber,
      twilioConnectedAt: connectedAt,
    };
  }

  /**
   * What changed: Super admin can unassign a platform Twilio number from a business.
   * Why: Assigned numbers need a safe way to detach without releasing from Twilio.
   * Related: assignTwilioNumber, BusinessTwilioIntegration, PlatformTwilioPhoneNumber
   */
  async unassignTwilioNumber(actor: User, dto: UnassignAdminTwilioNumberDto) {
    this.assertSuperAdmin(actor);

    const phoneNumber = dto.phoneNumber.trim();
    const phoneSid = dto.phoneSid?.trim() || '';

    const inventory =
      (phoneSid
        ? await this.platformTwilioPhoneNumberRepository.findOne({
            where: { phoneSid },
          })
        : null) ||
      (await this.platformTwilioPhoneNumberRepository.findOne({
        where: { phoneNumber },
      }));

    if (!inventory) {
      throw new NotFoundException(
        'That phone number is not in the Dealioo Twilio inventory.',
      );
    }

    const resolvedSid = inventory.phoneSid;
    const resolvedNumber = inventory.phoneNumber;
    const previousBusinessId = inventory.businessId;

    const businessesToClear = await this.businessRepository.find({
      where: [
        ...(previousBusinessId ? [{ id: previousBusinessId }] : []),
        { twilioPhoneSid: resolvedSid },
        { twilioPhoneNumber: resolvedNumber },
      ],
    });

    const clearedBusinesses: Array<{ id: number; name: string }> = [];
    for (const business of businessesToClear) {
      business.twilioPhoneSid = null;
      business.twilioPhoneNumber = null;
      business.twilioConnectedAt = null;
      await this.businessRepository.save(business);

      const integration =
        await this.businessTwilioIntegrationRepository.findOne({
          where: { businessId: business.id },
        });
      if (integration) {
        integration.twilioPhoneSid = null;
        integration.twilioPhoneNumber = null;
        integration.twilioConnectedAt = null;
        await this.businessTwilioIntegrationRepository.save(integration);
      }

      clearedBusinesses.push({ id: business.id, name: business.name });
    }

    await this.upsertPlatformTwilioNumber({
      phoneSid: resolvedSid,
      phoneNumber: resolvedNumber,
      businessId: null,
      connectedAt: null,
    });

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'twilio_number_unassigned',
      targetType: 'twilio_phone_number',
      targetId: inventory.id,
      metadata: {
        phoneNumber: resolvedNumber,
        previousBusinessId,
        clearedBusinessIds: clearedBusinesses.map((b) => b.id),
      },
    });

    return {
      phoneNumber: resolvedNumber,
      unassigned: true,
      previousBusinessId,
      clearedBusinesses,
    };
  }

  async listSubscriptions(
    actor: User,
    page?: number,
    limit?: number,
    searchRaw?: string,
    statusRaw?: string,
  ): Promise<{
    items: Array<{
      id: string;
      status: string;
      billingCycle: string;
      cancelAtPeriodEnd: boolean;
      startedAt: Date | null;
      cancelledAt: Date | null;
      cancelsAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      amount: number | null;
      currency: string;
      user: { id: number; name: string; email: string };
      plan: { id: string; name: string; slug: string };
    }>;
    meta: PaginationMeta;
    counts: {
      all: number;
      active: number;
      trialing: number;
      pastDue: number;
      cancelled: number;
    };
  }> {
    this.assertSuperAdmin(actor);

    const pagination = normalizePagination(page, limit);
    const search = searchRaw?.trim() ?? '';
    const statusFilter = this.normalizeSubscriptionStatusFilter(statusRaw);

    const qb = this.subscriptionRepository
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.user', 'user')
      .leftJoinAndSelect('sub.plan', 'plan')
      .orderBy('sub.createdAt', 'DESC');

    if (statusFilter) {
      qb.andWhere('sub.status = :status', { status: statusFilter });
    }

    if (search) {
      qb.andWhere(
        `(
          user.name ILIKE :q
          OR user.email ILIKE :q
          OR plan.name ILIKE :q
          OR plan.slug ILIKE :q
          OR CAST(user.id AS text) ILIKE :q
          OR CAST(sub.id AS text) ILIKE :q
        )`,
        { q: `%${search}%` },
      );
    }

    qb.skip(pagination.skip).take(pagination.limit);

    const [[rows, total], counts] = await Promise.all([
      qb.getManyAndCount(),
      this.buildSubscriptionStatusCounts(),
    ]);

    return {
      items: rows.map((sub) => this.toAdminSubscriptionItem(sub)),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      counts,
    };
  }

  async listSubscriptionPlans(actor: User) {
    this.assertSuperAdmin(actor);
    const plans = await this.subscriptionPlanRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const subscriberStats = await this.getPlanSubscriberStats(
      plans.map((plan) => plan.id),
    );
    return {
      items: plans.map((plan) =>
        this.toAdminPlanItem(plan, subscriberStats.get(plan.id)),
      ),
      counts: {
        all: plans.length,
        active: plans.filter((plan) => plan.isActive).length,
        inactive: plans.filter((plan) => !plan.isActive).length,
      },
    };
  }

  async createSubscriptionPlan(actor: User, dto: CreateAdminPlanDto) {
    this.assertSuperAdmin(actor);
    const slug = dto.slug.trim().toLowerCase();
    const existing = await this.subscriptionPlanRepository.findOne({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('A plan with this slug already exists.');
    }

    let sortOrder = dto.sortOrder;
    if (sortOrder == null) {
      const maxRow = await this.subscriptionPlanRepository
        .createQueryBuilder('plan')
        .select('MAX(plan.sortOrder)', 'max')
        .getRawOne<{ max: string | null }>();
      const maxValue = Number(maxRow?.max);
      sortOrder = Number.isFinite(maxValue) ? maxValue + 1 : 0;
    }

    const monthlyPrice = this.normalizePlanPriceInput(dto.monthlyPrice);
    const yearlyPrice = this.normalizePlanPriceInput(dto.yearlyPrice);
    const descriptionDto = {
      ...dto,
      monthlyPrice,
      yearlyPrice,
      monthlyOriginalPrice: this.normalizePlanPriceInput(
        dto.monthlyOriginalPrice,
      ),
      yearlyOriginalPrice: this.normalizePlanPriceInput(
        dto.yearlyOriginalPrice,
      ),
    };

    const plan = this.subscriptionPlanRepository.create({
      slug,
      name: dto.name.trim(),
      monthlyPrice,
      yearlyPrice,
      currency: (dto.currency?.trim() || 'USD').toUpperCase(),
      isActive: dto.isActive ?? true,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      stripeMonthlyPriceId: null,
      stripeYearlyPriceId: null,
      description: this.buildPlanDescription(null, descriptionDto),
    });

    try {
      await this.syncPlanPricesWithStripe(plan, {
        syncMonthly: plan.monthlyPrice != null,
        syncYearly: plan.yearlyPrice != null,
      });
      this.assertPlanStripeReady(plan);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? `Could not sync plan prices with Stripe: ${error.message}`
          : 'Could not sync plan prices with Stripe.',
      );
    }

    const saved = await this.subscriptionPlanRepository.save(plan);

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'subscription_plan_created',
      targetType: 'subscription_plan',
      targetId: saved.id,
      metadata: { slug: saved.slug, name: saved.name },
    });

    return this.toAdminPlanItem(saved, {
      activeSubscriberCount: 0,
      totalSubscriberCount: 0,
    });
  }

  async updateSubscriptionPlan(
    actor: User,
    planId: string,
    dto: UpdateAdminPlanDto,
  ) {
    this.assertSuperAdmin(actor);
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found.');
    }

    const previousMonthly = this.parsePlanDecimal(plan.monthlyPrice);
    const previousYearly = this.parsePlanDecimal(plan.yearlyPrice);
    const previousCurrency = (plan.currency || 'USD').toUpperCase();

    if (dto.slug != null) {
      const nextSlug = dto.slug.trim().toLowerCase();
      if (nextSlug !== plan.slug) {
        const clash = await this.subscriptionPlanRepository.findOne({
          where: { slug: nextSlug },
        });
        if (clash) {
          throw new ConflictException('A plan with this slug already exists.');
        }
        plan.slug = nextSlug;
      }
    }

    if (dto.name != null) plan.name = dto.name.trim();
    if (dto.monthlyPrice !== undefined) {
      plan.monthlyPrice = this.normalizePlanPriceInput(dto.monthlyPrice);
    }
    if (dto.yearlyPrice !== undefined) {
      plan.yearlyPrice = this.normalizePlanPriceInput(dto.yearlyPrice);
    }
    if (dto.currency != null) {
      plan.currency = dto.currency.trim().toUpperCase() || plan.currency;
    }
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) plan.sortOrder = dto.sortOrder;

    const descriptionDto = {
      ...dto,
      monthlyPrice:
        dto.monthlyPrice !== undefined
          ? this.normalizePlanPriceInput(dto.monthlyPrice)
          : undefined,
      yearlyPrice:
        dto.yearlyPrice !== undefined
          ? this.normalizePlanPriceInput(dto.yearlyPrice)
          : undefined,
      monthlyOriginalPrice:
        dto.monthlyOriginalPrice !== undefined
          ? this.normalizePlanPriceInput(dto.monthlyOriginalPrice)
          : undefined,
      yearlyOriginalPrice:
        dto.yearlyOriginalPrice !== undefined
          ? this.normalizePlanPriceInput(dto.yearlyOriginalPrice)
          : undefined,
    };

    const touchesDescription =
      dto.badge !== undefined ||
      dto.tagline !== undefined ||
      dto.summary !== undefined ||
      dto.cta !== undefined ||
      dto.highlighted !== undefined ||
      dto.color !== undefined ||
      dto.features !== undefined ||
      dto.monthlyPrice !== undefined ||
      dto.yearlyPrice !== undefined ||
      dto.monthlyOriginalPrice !== undefined ||
      dto.yearlyOriginalPrice !== undefined ||
      dto.promo !== undefined;

    if (touchesDescription) {
      plan.description = this.buildPlanDescription(
        plan.description,
        descriptionDto,
      );
    }

    const nextMonthly = this.parsePlanDecimal(plan.monthlyPrice);
    const nextYearly = this.parsePlanDecimal(plan.yearlyPrice);
    const nextCurrency = (plan.currency || 'USD').toUpperCase();
    const currencyChanged = nextCurrency !== previousCurrency;

    try {
      await this.syncPlanPricesWithStripe(plan, {
        syncMonthly:
          currencyChanged ||
          (dto.monthlyPrice !== undefined && nextMonthly !== previousMonthly),
        syncYearly:
          currencyChanged ||
          (dto.yearlyPrice !== undefined && nextYearly !== previousYearly),
      });
      this.assertPlanStripeReady(plan);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? `Could not sync plan prices with Stripe: ${error.message}`
          : 'Could not sync plan prices with Stripe.',
      );
    }

    const saved = await this.subscriptionPlanRepository.save(plan);

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'subscription_plan_updated',
      targetType: 'subscription_plan',
      targetId: saved.id,
      metadata: {
        slug: saved.slug,
        name: saved.name,
        monthlyPrice: nextMonthly,
        yearlyPrice: nextYearly,
      },
    });

    const stats = await this.getPlanSubscriberStats([saved.id]);
    return this.toAdminPlanItem(saved, stats.get(saved.id));
  }

  async deleteSubscriptionPlan(actor: User, planId: string) {
    this.assertSuperAdmin(actor);
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found.');
    }

    const stats = await this.getPlanSubscriberStats([plan.id]);
    const planStats = stats.get(plan.id) ?? {
      activeSubscriberCount: 0,
      totalSubscriberCount: 0,
    };
    if (planStats.totalSubscriberCount > 0) {
      throw new ConflictException(
        planStats.activeSubscriberCount > 0
          ? `Cannot delete "${plan.name}" while ${planStats.activeSubscriberCount} subscriber(s) are still on it. Deactivate the plan instead.`
          : `Cannot delete "${plan.name}" because subscription history still references it. Deactivate the plan instead.`,
      );
    }

    await this.subscriptionPlanRepository.remove(plan);

    await this.writeAudit({
      actorUserId: actor.id,
      action: 'subscription_plan_deleted',
      targetType: 'subscription_plan',
      targetId: planId,
      metadata: { slug: plan.slug, name: plan.name },
    });

    return { deleted: true, id: planId };
  }

  private async syncPlanPricesWithStripe(
    plan: SubscriptionPlan,
    opts: { syncMonthly: boolean; syncYearly: boolean },
  ): Promise<void> {
    const monthly = this.parsePlanDecimal(plan.monthlyPrice);
    const yearly = this.parsePlanDecimal(plan.yearlyPrice);
    const currency = plan.currency || 'USD';

    if (opts.syncMonthly) {
      if (monthly != null && monthly > 0) {
        const created =
          await this.stripeService.createPlatformPlanRecurringPrice({
            planSlug: plan.slug,
            planName: plan.name,
            amountDollars: monthly,
            currency,
            interval: 'month',
            existingPriceId: plan.stripeMonthlyPriceId,
          });
        plan.stripeMonthlyPriceId = created.stripePriceId;
      } else {
        plan.stripeMonthlyPriceId = null;
      }
    }

    if (opts.syncYearly) {
      if (yearly != null && yearly > 0) {
        const created =
          await this.stripeService.createPlatformPlanRecurringPrice({
            planSlug: plan.slug,
            planName: plan.name,
            amountDollars: yearly,
            currency,
            interval: 'year',
            existingPriceId: plan.stripeYearlyPriceId,
          });
        plan.stripeYearlyPriceId = created.stripePriceId;
      } else {
        plan.stripeYearlyPriceId = null;
      }
    }
  }

  private toAdminSubscriptionItem(sub: UserSubscription) {
    const plan = sub.plan;
    const user = sub.user;
    const amount =
      sub.billingCycle === 'annual'
        ? this.parsePlanDecimal(plan?.yearlyPrice)
        : this.parsePlanDecimal(plan?.monthlyPrice);

    return {
      id: sub.id,
      status: sub.status,
      billingCycle: sub.billingCycle,
      cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
      startedAt: sub.startedAt,
      cancelledAt: sub.cancelledAt,
      cancelsAt: sub.cancelsAt,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
      amount,
      currency: (plan?.currency?.trim() || 'USD').toUpperCase(),
      user: {
        id: user?.id ?? 0,
        name: user?.name?.trim() || '—',
        email: user?.email?.trim() || '—',
      },
      plan: {
        id: plan?.id ?? '',
        name: plan?.name?.trim() || '—',
        slug: plan?.slug?.trim() || 'unknown',
      },
    };
  }

  private normalizeSubscriptionStatusFilter(
    statusRaw?: string,
  ): 'active' | 'trialing' | 'past_due' | 'cancelled' | null {
    const status = statusRaw?.trim().toLowerCase() ?? '';
    if (
      status === 'active' ||
      status === 'trialing' ||
      status === 'past_due' ||
      status === 'cancelled'
    ) {
      return status;
    }
    return null;
  }

  private async buildSubscriptionStatusCounts(): Promise<{
    all: number;
    active: number;
    trialing: number;
    pastDue: number;
    cancelled: number;
  }> {
    const rows = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .select('sub.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('sub.status')
      .getRawMany<{ status: string; count: string }>();

    const byStatus = new Map<string, number>();
    let all = 0;
    for (const row of rows) {
      const count = Number(row.count) || 0;
      all += count;
      byStatus.set(String(row.status ?? '').toLowerCase(), count);
    }

    return {
      all,
      active: byStatus.get('active') ?? 0,
      trialing: byStatus.get('trialing') ?? 0,
      pastDue: byStatus.get('past_due') ?? 0,
      cancelled: byStatus.get('cancelled') ?? 0,
    };
  }

  private async getPlanSubscriberStats(
    planIds: string[],
  ): Promise<
    Map<string, { activeSubscriberCount: number; totalSubscriberCount: number }>
  > {
    const map = new Map<
      string,
      { activeSubscriberCount: number; totalSubscriberCount: number }
    >();
    for (const id of planIds) {
      map.set(id, { activeSubscriberCount: 0, totalSubscriberCount: 0 });
    }
    if (planIds.length === 0) return map;

    const rows = await this.subscriptionRepository
      .createQueryBuilder('sub')
      .select('sub.planId', 'planId')
      .addSelect('sub.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('sub.planId IN (:...planIds)', { planIds })
      .groupBy('sub.planId')
      .addGroupBy('sub.status')
      .getRawMany<{ planId: string; status: string; count: string }>();

    for (const row of rows) {
      const current = map.get(row.planId) ?? {
        activeSubscriberCount: 0,
        totalSubscriberCount: 0,
      };
      const count = Number(row.count) || 0;
      current.totalSubscriberCount += count;
      const status = String(row.status ?? '').toLowerCase();
      if (
        status === 'active' ||
        status === 'trialing' ||
        status === 'past_due'
      ) {
        current.activeSubscriberCount += count;
      }
      map.set(row.planId, current);
    }
    return map;
  }

  private assertPlanStripeReady(plan: SubscriptionPlan): void {
    const monthly = this.parsePlanDecimal(plan.monthlyPrice);
    const yearly = this.parsePlanDecimal(plan.yearlyPrice);
    if (monthly != null && monthly > 0 && !plan.stripeMonthlyPriceId?.trim()) {
      throw new BadRequestException(
        'Monthly price is set but Stripe monthly price sync did not complete.',
      );
    }
    if (yearly != null && yearly > 0 && !plan.stripeYearlyPriceId?.trim()) {
      throw new BadRequestException(
        'Yearly price is set but Stripe yearly price sync did not complete.',
      );
    }
  }

  private toAdminPlanItem(
    plan: SubscriptionPlan,
    subscriberStats?: {
      activeSubscriberCount: number;
      totalSubscriberCount: number;
    },
  ) {
    const monthlyPrice = this.parsePlanDecimal(plan.monthlyPrice);
    const yearlyPrice = this.parsePlanDecimal(plan.yearlyPrice);
    const monthlySynced = Boolean(plan.stripeMonthlyPriceId?.trim());
    const yearlySynced = Boolean(plan.stripeYearlyPriceId?.trim());
    const activeSubscriberCount = subscriberStats?.activeSubscriberCount ?? 0;
    const totalSubscriberCount = subscriberStats?.totalSubscriberCount ?? 0;

    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      monthlyPrice,
      yearlyPrice,
      currency: plan.currency,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      description: plan.description,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      activeSubscriberCount,
      totalSubscriberCount,
      canDelete: totalSubscriberCount === 0,
      stripe: {
        monthlySynced,
        yearlySynced,
        billingReady:
          (monthlyPrice == null || monthlySynced) &&
          (yearlyPrice == null || yearlySynced),
      },
    };
  }

  private parsePlanDecimal(value: unknown): number | null {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizePlanPriceInput(
    value: number | null | undefined,
  ): number | null {
    if (value == null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100) / 100;
  }

  private buildPlanDescription(
    existing: SubscriptionPlanDescription | null,
    input: {
      badge?: string | null;
      tagline?: string;
      summary?: string;
      cta?: string;
      highlighted?: boolean;
      color?: string;
      features?: string[];
      monthlyPrice?: number | null;
      yearlyPrice?: number | null;
      monthlyOriginalPrice?: number | null;
      yearlyOriginalPrice?: number | null;
      promo?: string | null;
    },
  ): SubscriptionPlanDescription {
    const formatPrice = (value: number | null | undefined) => {
      if (value == null) return 'Custom';
      if (Number.isInteger(value)) return `$${value}`;
      return `$${value.toFixed(2)}`;
    };

    const formatOptionalPrice = (value: number | null | undefined) => {
      if (value == null) return null;
      return formatPrice(value);
    };

    const nextMonthlyPrice =
      input.monthlyPrice !== undefined
        ? formatPrice(input.monthlyPrice)
        : (existing?.monthly?.price ?? 'Custom');
    const nextAnnualPrice =
      input.yearlyPrice !== undefined
        ? input.yearlyPrice == null
          ? 'Custom'
          : formatPrice(Math.round((input.yearlyPrice / 12) * 100) / 100)
        : (existing?.annual?.price ?? 'Custom');
    const nextAnnualSubline =
      input.yearlyPrice !== undefined
        ? input.yearlyPrice == null
          ? null
          : `Billed annually ($${input.yearlyPrice}/year)`
        : (existing?.annual?.subline ?? null);

    const features =
      input.features !== undefined
        ? input.features.map((item) => item.trim()).filter(Boolean)
        : existing?.features;

    const nextPromo =
      input.promo !== undefined
        ? input.promo?.trim() || null
        : (existing?.monthly?.promo ?? existing?.annual?.promo ?? null);

    const nextMonthlyOriginal =
      input.monthlyOriginalPrice !== undefined
        ? formatOptionalPrice(input.monthlyOriginalPrice)
        : (existing?.monthly?.originalPrice ?? null);

    const nextYearlyOriginal =
      input.yearlyOriginalPrice !== undefined
        ? formatOptionalPrice(input.yearlyOriginalPrice)
        : (existing?.annual?.originalPrice ?? null);

    return {
      badge:
        input.badge !== undefined
          ? input.badge?.trim() || null
          : (existing?.badge ?? null),
      tagline:
        input.tagline !== undefined
          ? input.tagline.trim()
          : (existing?.tagline ?? ''),
      summary:
        input.summary !== undefined
          ? input.summary.trim()
          : (existing?.summary ?? ''),
      features: features && features.length > 0 ? features : undefined,
      featureGroups: existing?.featureGroups,
      cta:
        input.cta !== undefined
          ? input.cta.trim() || 'Continue'
          : (existing?.cta ?? 'Continue'),
      highlighted:
        input.highlighted !== undefined
          ? input.highlighted
          : (existing?.highlighted ?? false),
      salesEmail: existing?.salesEmail ?? null,
      color:
        input.color !== undefined
          ? input.color.trim() || existing?.color || '#1877F2'
          : (existing?.color ?? '#1877F2'),
      monthly: {
        price: nextMonthlyPrice,
        period: nextMonthlyPrice === 'Custom' ? '' : '/ month',
        originalPrice: nextMonthlyOriginal,
        promo: nextPromo,
        subline:
          nextMonthlyPrice === 'Custom'
            ? null
            : (existing?.monthly?.subline ?? 'Billed monthly'),
      },
      annual: {
        price: nextAnnualPrice,
        period: nextAnnualPrice === 'Custom' ? '' : '/ mo',
        originalPrice: nextYearlyOriginal,
        promo: nextPromo,
        subline: nextAnnualSubline,
      },
    };
  }
}

function normalizeDashboardPeriod(raw?: string): PlatformDashboardPeriod {
  const value = (raw ?? 'month').trim().toLowerCase();
  if (value === 'today' || value === 'week' || value === 'year') return value;
  return 'month';
}

function calendarDateInTimeZone(date: Date, timeZone: string): string {
  const tz = resolveSafeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function shiftCalendarDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function startOfCalendarDayInTimeZone(dateKey: string, timeZone: string): Date {
  return new Date(
    zonedDateTime(dateKey, '00:00', resolveSafeTimeZone(timeZone)),
  );
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
    const todayKey = calendarDateInTimeZone(now, tz);
    const from = startOfCalendarDayInTimeZone(todayKey, tz);
    const to = now;
    const priorFrom = startOfCalendarDayInTimeZone(
      shiftCalendarDateKey(todayKey, -1),
      tz,
    );
    const priorTo = new Date(from.getTime() - 1);
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
    const todayKey = calendarDateInTimeZone(now, tz);
    const fromKey = shiftCalendarDateKey(todayKey, -6);
    const from = startOfCalendarDayInTimeZone(fromKey, tz);
    const to = now;
    const priorFromKey = shiftCalendarDateKey(fromKey, -6);
    const priorFrom = startOfCalendarDayInTimeZone(priorFromKey, tz);
    const priorTo = new Date(from.getTime() - 1);
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

  // Use the viewer's timezone month bounds (not raw UTC), so Jan 2026
  // only includes events that happened in that local calendar month.
  const pad = (value: number) => String(value).padStart(2, '0');
  const fromKey = `${year}-${pad(month)}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthKey = `${nextYear}-${pad(nextMonth)}-01`;
  const from = startOfCalendarDayInTimeZone(fromKey, tz);
  const nextMonthStart = startOfCalendarDayInTimeZone(nextMonthKey, tz);
  const monthEnd = new Date(nextMonthStart.getTime() - 1);
  const clampedTo = monthEnd.getTime() > now.getTime() ? now : monthEnd;

  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  const priorFromKey = `${priorYear}-${pad(priorMonth)}-01`;
  const priorFrom = startOfCalendarDayInTimeZone(priorFromKey, tz);
  const priorTo = new Date(from.getTime() - 1);

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

function buildMonthBucketKeys(
  from: Date,
  to: Date,
  timeZone: string,
): string[] {
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
  const endMonth = Number(
    endParts.find((part) => part.type === 'month')?.value,
  );
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
