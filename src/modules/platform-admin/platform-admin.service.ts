import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThanOrEqual, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Business } from '../../db/entities/business.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { isSuperAdmin } from '../../utils/user-roles';
import {
  buildUtcRangeBucketKeys,
  overviewRangeBucketSql,
} from '../funnel-event/overview-monthly.util';

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
    email: string | null;
    phoneNumber: string | null;
    onboardingCompleted: boolean;
    stripeConnected: boolean;
    metaConnected: boolean;
    twilioConnected: boolean;
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
  }>;
};

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(AdminNotification)
    private readonly adminNotificationRepository: Repository<AdminNotification>,
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepository: Repository<MeetingRequest>,
  ) {}

  private assertSuperAdmin(user: User): void {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only Super Admin can access the platform overview.',
      );
    }
  }

  private paidPaymentQuery(from: Date, toExclusive?: Date) {
    const qb = this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.status = :paid', { paid: FunnelPaymentStatus.PAID })
      .andWhere('COALESCE(payment.paidAt, payment.createdAt) >= :from', {
        from,
      });
    if (toExclusive) {
      qb.andWhere('COALESCE(payment.paidAt, payment.createdAt) < :to', {
        to: toExclusive,
      });
    }
    return qb;
  }

  async getMeetingRequests(actor: User): Promise<{
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
      createdAt: Date;
    }>;
  }> {
    this.assertSuperAdmin(actor);

    const [items, total] = await this.meetingRequestRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: 200,
    });

    return {
      total,
      items: items.map((row) => ({
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
        createdAt: row.createdAt,
      })),
    };
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
  ): Promise<{
    from: string;
    to: string;
    totalRevenueCents: number;
    newBusinesses: number;
    points: Array<{
      bucket: string;
      revenueCents: number;
      businesses: number;
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

    const { sameDay, keys } = buildUtcRangeBucketKeys(from, to);
    const paymentTime = 'COALESCE(payment.paid_at, payment.created_at)';
    const paymentBucket = overviewRangeBucketSql(paymentTime, sameDay);
    const businessBucket = overviewRangeBucketSql('b.created_at', sameDay);

    const [revenueRows, businessRows] = await Promise.all([
      this.paidPaymentQuery(from)
        .select(paymentBucket, 'bucket')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .andWhere('COALESCE(payment.paidAt, payment.createdAt) <= :rangeEnd', {
          rangeEnd: to,
        })
        .groupBy(paymentBucket)
        .getRawMany<Record<string, string>>(),
      this.businessRepository
        .createQueryBuilder('b')
        .select(businessBucket, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('b.created_at >= :from', { from })
        .andWhere('b.created_at <= :to', { to })
        .groupBy(businessBucket)
        .getRawMany<{ bucket: string; count: string }>(),
    ]);

    const revenueMap = new Map(
      revenueRows.map((row) => [
        String(row.bucket ?? ''),
        Number(row.total) || 0,
      ]),
    );
    const businessMap = new Map(
      businessRows.map((row) => [row.bucket, Number(row.count) || 0]),
    );
    const points = keys.map((bucket) => ({
      bucket,
      revenueCents: revenueMap.get(bucket) ?? 0,
      businesses: businessMap.get(bucket) ?? 0,
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalRevenueCents: points.reduce(
        (sum, point) => sum + point.revenueCents,
        0,
      ),
      newBusinesses: points.reduce((sum, point) => sum + point.businesses, 0),
      points,
    };
  }

  async getKpis(actor: User): Promise<PlatformAdminOverview['kpis']> {
    this.assertSuperAdmin(actor);
    return this.computeKpis();
  }

  private async computeKpis(): Promise<PlatformAdminOverview['kpis']> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = addDays(todayStart, -1);
    const day30Ago = addDays(todayStart, -29);
    const day60Ago = addDays(todayStart, -59);

    const [
      totalUsers,
      totalBusinesses,
      activeBusinesses,
      newUsersToday,
      newUsersYesterday,
      ordersToday,
      ordersYesterday,
      allTimeRevenue,
      businessesLast30,
      businessesPrev30,
      usersLast30,
      usersPrev30,
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
      this.paidPaymentQuery(todayStart)
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .getRawOne<{ count: string; total: string }>(),
      this.paidPaymentQuery(yesterdayStart, todayStart)
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .getRawOne<{ count: string; total: string }>(),
      this.funnelPaymentRepository
        .createQueryBuilder('payment')
        .select('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.status = :paid', { paid: FunnelPaymentStatus.PAID })
        .getRawOne<{ total: string }>(),
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
    ]);

    const ordersTodayCount = Number(ordersToday?.count) || 0;
    const ordersYesterdayCount = Number(ordersYesterday?.count) || 0;
    const revenueTodayCents = Number(allTimeRevenue?.total) || 0;

    return {
      totalBusinesses,
      activeBusinesses,
      totalUsers,
      newUsersToday,
      ordersToday: ordersTodayCount,
      revenueTodayCents,
      businessesChangePct: pctChange(businessesLast30, businessesPrev30),
      activeBusinessesChangePct: pctChange(
        activeBusinesses,
        Math.max(activeBusinesses - businessesLast30, 0),
      ),
      usersChangePct: pctChange(usersLast30, usersPrev30),
      newUsersChangePct: pctChange(newUsersToday, newUsersYesterday),
      ordersChangePct: pctChange(ordersTodayCount, ordersYesterdayCount),
      revenueChangePct: 0,
    };
  }

  async getOverview(actor: User): Promise<PlatformAdminOverview> {
    this.assertSuperAdmin(actor);

    const [kpis, businesses, users] = await Promise.all([
      this.computeKpis(),
      this.businessRepository.find({
        relations: ['owner'],
        order: { createdAt: 'DESC' },
      }),
      this.userRepository.find({
        relations: ['role'],
        order: { createdAt: 'DESC' },
      }),
    ]);

    const userIds = users.map((user) => user.id);
    const planByUserId = new Map<
      number,
      { planName: string; planSlug: string }
    >();
    if (userIds.length > 0) {
      const userSubs = await this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoinAndSelect('sub.plan', 'plan')
        .where('sub.user_id IN (:...userIds)', { userIds })
        .andWhere('sub.status IN (:...statuses)', {
          statuses: ['active', 'trialing', 'past_due'],
        })
        .orderBy('sub.created_at', 'DESC')
        .getMany();
      for (const sub of userSubs) {
        if (!planByUserId.has(sub.userId)) {
          planByUserId.set(sub.userId, {
            planName: sub.plan?.name ?? '—',
            planSlug: sub.plan?.slug ?? 'unknown',
          });
        }
      }
    }

    const planFitSlugs = [
      ...new Set(
        users
          .map(
            (user) =>
              user.planFitSelectedPlan?.trim() ||
              user.planFitRecommendedPlan?.trim() ||
              '',
          )
          .filter(Boolean),
      ),
    ];
    const planNameBySlug = new Map<string, string>();
    if (planFitSlugs.length > 0) {
      const planRows = await this.subscriptionRepository.manager
        .getRepository(SubscriptionPlan)
        .find({
          where: { slug: In(planFitSlugs) },
          select: ['slug', 'name'],
        });
      for (const row of planRows) {
        planNameBySlug.set(row.slug, row.name);
      }
    }

    for (const user of users) {
      if (planByUserId.has(user.id)) continue;
      const slug =
        user.planFitSelectedPlan?.trim() ||
        user.planFitRecommendedPlan?.trim() ||
        '';
      if (!slug) continue;
      planByUserId.set(user.id, {
        planSlug: slug,
        planName: planNameBySlug.get(slug) ?? slug,
      });
    }

    return {
      kpis,
      charts: {
        revenueLast30Days: [],
        businessesLast30Days: [],
        subscriptionBreakdown: [],
      },
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name,
        slug: business.slug,
        logoUrl: business.logoUrl,
        city: business.city,
        state: business.state,
        country: business.country,
        email: business.email,
        phoneNumber: business.phoneNumber,
        onboardingCompleted: business.onboardingCompleted,
        stripeConnected: Boolean(business.stripeAccountId?.trim()),
        metaConnected: Boolean(
          business.metaUserId?.trim() ||
            business.metaConnectionStatus?.trim() === 'ACTIVE',
        ),
        twilioConnected: Boolean(
          business.twilioPhoneSid?.trim() ||
            business.twilioPhoneNumber?.trim(),
        ),
        createdAt: business.createdAt,
        ownerName: business.owner?.name ?? null,
        ownerEmail: business.owner?.email ?? null,
        ownerAvatar: business.owner?.avatar ?? null,
        planName: null,
        planSlug: null,
      })),
      users: users
        .filter((user) => user.id !== actor.id)
        .map((user) => {
          const plan = planByUserId.get(user.id) ?? null;
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
          };
        }),
    };
  }
}
