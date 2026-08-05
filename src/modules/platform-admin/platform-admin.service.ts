import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { Order, OrderStatus } from '../../db/entities/order.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { isSuperAdmin } from '../../utils/user-roles';

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

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  }>;
};

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
  ) {}

  private assertSuperAdmin(user: User): void {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only Super Admin can access the platform overview.',
      );
    }
  }

  async getOverview(actor: User): Promise<PlatformAdminOverview> {
    this.assertSuperAdmin(actor);

    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = addDays(todayStart, -1);
    const day30Ago = addDays(todayStart, -29);
    const day60Ago = addDays(todayStart, -59);
    const day30End = addDays(todayStart, 1);

    const [
      totalUsers,
      totalBusinesses,
      activeBusinesses,
      newUsersToday,
      newUsersYesterday,
      businesses,
      users,
      ordersTodayRows,
      ordersYesterdayRows,
      businessesLast30,
      businessesPrev30,
      usersLast30,
      usersPrev30,
      revenueRows,
      subscriptionRows,
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
      this.businessRepository.find({
        relations: ['owner'],
        order: { createdAt: 'DESC' },
      }),
      this.userRepository.find({
        relations: ['role'],
        order: { createdAt: 'DESC' },
      }),
      this.orderRepository.find({
        where: {
          createdAt: MoreThanOrEqual(todayStart),
          status: OrderStatus.PAID,
        },
      }),
      this.orderRepository.find({
        where: {
          createdAt: Between(yesterdayStart, todayStart),
          status: OrderStatus.PAID,
        },
      }),
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
      this.orderRepository
        .createQueryBuilder('o')
        .select("TO_CHAR(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'day')
        .addSelect('COALESCE(SUM(o.total_amount), 0)', 'total')
        .where('o.deleted_at IS NULL')
        .andWhere('o.status = :status', { status: OrderStatus.PAID })
        .andWhere('o.created_at >= :from', { from: day30Ago })
        .andWhere('o.created_at < :to', { to: day30End })
        .groupBy('day')
        .orderBy('day', 'ASC')
        .getRawMany<{ day: string; total: string }>(),
      this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoin('sub.plan', 'plan')
        .select('plan.slug', 'planSlug')
        .addSelect('plan.name', 'planName')
        .addSelect('COUNT(*)', 'count')
        .where('sub.status IN (:...statuses)', {
          statuses: ['active', 'trialing'],
        })
        .groupBy('plan.slug')
        .addGroupBy('plan.name')
        .orderBy('COUNT(*)', 'DESC')
        .getRawMany<{ planSlug: string; planName: string; count: string }>(),
    ]);

    const businessDayRows = await this.businessRepository
      .createQueryBuilder('b')
      .select("TO_CHAR(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'day')
      .addSelect('COUNT(*)', 'count')
      .where('b.created_at >= :from', { from: day30Ago })
      .andWhere('b.created_at < :to', { to: day30End })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();

    const revenueMap = new Map(
      revenueRows.map((r) => [r.day, Number(r.total) || 0]),
    );
    const businessMap = new Map(
      businessDayRows.map((r) => [r.day, Number(r.count) || 0]),
    );

    const revenueLast30Days: Array<{ date: string; amountCents: number }> = [];
    const businessesLast30Days: Array<{ date: string; count: number }> = [];
    for (let i = 0; i < 30; i++) {
      const day = isoDay(addDays(day30Ago, i));
      revenueLast30Days.push({
        date: day,
        amountCents: revenueMap.get(day) ?? 0,
      });
      businessesLast30Days.push({
        date: day,
        count: businessMap.get(day) ?? 0,
      });
    }

    const revenueTodayCents = ordersTodayRows.reduce(
      (sum, o) => sum + (o.totalAmount || 0),
      0,
    );
    const revenueYesterdayCents = ordersYesterdayRows.reduce(
      (sum, o) => sum + (o.totalAmount || 0),
      0,
    );

    const ownerIds = [
      ...new Set(
        businesses
          .map((b) => b.owner?.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const ownerPlanByUserId = new Map<
      number,
      { planName: string; planSlug: string }
    >();
    if (ownerIds.length > 0) {
      const ownerSubs = await this.subscriptionRepository
        .createQueryBuilder('sub')
        .innerJoinAndSelect('sub.plan', 'plan')
        .where('sub.user_id IN (:...ownerIds)', { ownerIds })
        .andWhere('sub.status IN (:...statuses)', {
          statuses: ['active', 'trialing'],
        })
        .orderBy('sub.created_at', 'DESC')
        .getMany();
      for (const sub of ownerSubs) {
        if (!ownerPlanByUserId.has(sub.userId)) {
          ownerPlanByUserId.set(sub.userId, {
            planName: sub.plan?.name ?? '—',
            planSlug: sub.plan?.slug ?? 'unknown',
          });
        }
      }
    }

    return {
      kpis: {
        totalBusinesses,
        activeBusinesses,
        totalUsers,
        newUsersToday,
        ordersToday: ordersTodayRows.length,
        revenueTodayCents,
        businessesChangePct: pctChange(businessesLast30, businessesPrev30),
        activeBusinessesChangePct: pctChange(
          activeBusinesses,
          Math.max(activeBusinesses - businessesLast30, 0),
        ),
        usersChangePct: pctChange(usersLast30, usersPrev30),
        newUsersChangePct: pctChange(newUsersToday, newUsersYesterday),
        ordersChangePct: pctChange(
          ordersTodayRows.length,
          ordersYesterdayRows.length,
        ),
        revenueChangePct: pctChange(revenueTodayCents, revenueYesterdayCents),
      },
      charts: {
        revenueLast30Days,
        businessesLast30Days,
        subscriptionBreakdown: subscriptionRows.map((row) => ({
          planSlug: row.planSlug,
          planName: row.planName,
          count: Number(row.count) || 0,
        })),
      },
      businesses: businesses.map((business) => {
        const ownerId = business.owner?.id;
        const plan =
          ownerId != null ? ownerPlanByUserId.get(ownerId) ?? null : null;
        return {
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
          planName: plan?.planName ?? null,
          planSlug: plan?.planSlug ?? null,
        };
      }),
      users: users
        .filter((user) => user.id !== actor.id)
        .map((user) => ({
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
        })),
    };
  }
}
