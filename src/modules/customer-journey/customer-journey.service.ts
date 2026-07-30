import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  CustomerActivity,
  CustomerActivityType,
} from '../../db/entities/customer-activity.entity';
import {
  CustomerJourneyEvent,
  CustomerJourneyStep,
} from '../../db/entities/customer-journey-event.entity';
import { CustomerVisit, CustomerVisitSource } from '../../db/entities/customer-visit.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelPayment,
  FunnelPaymentSource,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Coupon, CouponStatus } from '../../db/entities/coupon.entity';

export type RecordJourneyStepInput = {
  businessId: number;
  customerId: number;
  campaignId: number;
  funnelId?: number | null;
  step: CustomerJourneyStep;
  occurredAt: Date;
  source: string;
  refType?: string | null;
  refId?: string | number | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
  manager?: EntityManager;
};

export type JourneyStepState = 'complete' | 'current' | 'pending';

export type JourneyStepView = {
  step: CustomerJourneyStep;
  label: string;
  state: JourneyStepState;
  occurredAt: string | null;
  source: string | null;
};

export type CustomerJourneyTimelineItem = {
  id: string;
  activityType: CustomerActivityType;
  label: string;
  source: string;
  amount: number | null;
  currency: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
};

export type CustomerJourneyView = {
  customerId: number;
  campaignId: number;
  funnelId: number | null;
  funnelPaymentId: number | null;
  steps: JourneyStepView[];
  timeline: CustomerJourneyTimelineItem[];
  lastUpdatedAt: string | null;
};

const JOURNEY_STEPS: Array<{
  step: CustomerJourneyStep;
  label: string;
}> = [
  { step: CustomerJourneyStep.SIGNUP, label: 'Signed Up' },
  { step: CustomerJourneyStep.PAYMENT, label: 'Paid' },
  { step: CustomerJourneyStep.QR_REDEEMED, label: 'QR Redeemed' },
];

type ResolvedStep = {
  event: CustomerJourneyEvent | null;
  occurredAt: Date | null;
  source: string | null;
};

@Injectable()
export class CustomerJourneyService {
  private readonly logger = new Logger(CustomerJourneyService.name);

  constructor(
    @InjectRepository(CustomerJourneyEvent)
    private readonly journeyRepository: Repository<CustomerJourneyEvent>,
    @InjectRepository(CustomerActivity)
    private readonly customerActivityRepository: Repository<CustomerActivity>,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
  ) {}

  async recordStep(input: RecordJourneyStepInput): Promise<void> {
    const repo = input.manager
      ? input.manager.getRepository(CustomerJourneyEvent)
      : this.journeyRepository;

    try {
      const existing = await repo.findOne({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return;
      }

      await repo.save(
        repo.create({
          businessId: input.businessId,
          customerId: input.customerId,
          campaignId: input.campaignId,
          funnelId: input.funnelId ?? null,
          step: input.step,
          occurredAt: input.occurredAt,
          source: input.source,
          refType: input.refType ?? null,
          refId: input.refId == null ? null : String(input.refId),
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/duplicate|unique/i.test(message)) {
        return;
      }
      this.logger.warn(`Journey step write failed (${input.step}): ${message}`);
    }
  }

  async recordSignup(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId: number;
    occurredAt?: Date;
    source?: string;
    funnelEventId?: number | null;
    manager?: EntityManager;
  }): Promise<void> {
    await this.recordStep({
      businessId: params.businessId,
      customerId: params.customerId,
      campaignId: params.campaignId,
      funnelId: params.funnelId,
      step: CustomerJourneyStep.SIGNUP,
      occurredAt: params.occurredAt ?? new Date(),
      source: params.source ?? 'funnel_signup',
      refType: params.funnelEventId != null ? 'funnel_event' : null,
      refId: params.funnelEventId ?? null,
      idempotencyKey: `journey:signup:funnel:${params.funnelId}:customer:${params.customerId}`,
      manager: params.manager,
    });
  }

  async recordPayment(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId: number;
    funnelPaymentId: number;
    occurredAt?: Date;
    source?: string;
    manager?: EntityManager;
  }): Promise<void> {
    await this.recordStep({
      businessId: params.businessId,
      customerId: params.customerId,
      campaignId: params.campaignId,
      funnelId: params.funnelId,
      step: CustomerJourneyStep.PAYMENT,
      occurredAt: params.occurredAt ?? new Date(),
      source: params.source ?? 'funnel_payment',
      refType: 'funnel_payment',
      refId: params.funnelPaymentId,
      idempotencyKey: `journey:payment:payment:${params.funnelPaymentId}`,
      manager: params.manager,
    });
  }

  async recordQrRedeemed(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId?: number | null;
    couponId: number;
    funnelPaymentId?: number | null;
    occurredAt?: Date;
    source?: string;
    manager?: EntityManager;
  }): Promise<void> {
    await this.recordStep({
      businessId: params.businessId,
      customerId: params.customerId,
      campaignId: params.campaignId,
      funnelId: params.funnelId ?? null,
      step: CustomerJourneyStep.QR_REDEEMED,
      occurredAt: params.occurredAt ?? new Date(),
      source: params.source ?? 'qr_redemption',
      refType: 'coupon',
      refId: params.couponId,
      idempotencyKey: `journey:qr:coupon:${params.couponId}`,
      metadata:
        params.funnelPaymentId != null
          ? { funnelPaymentId: params.funnelPaymentId }
          : null,
      manager: params.manager,
    });
  }

  async getJourney(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId?: number | null;
    funnelPaymentId?: number | null;
  }): Promise<CustomerJourneyView> {
    const activities = await this.loadCampaignActivities(params);
    const timeline = activities.map((row) => this.toTimelineItem(row));

    if (activities.length > 0) {
      return this.buildJourneyFromActivities(params, activities, timeline);
    }

    const events = await this.journeyRepository.find({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
        campaignId: params.campaignId,
        step: In(JOURNEY_STEPS.map((item) => item.step)),
      },
      order: { occurredAt: 'ASC' },
    });

    const signup = this.pickSignupStep(events);
    const payment = this.pickPaymentStep(events, params.funnelPaymentId);
    const qr = this.pickQrStepFromEventsOnly(events, params.funnelPaymentId);
    const includeQrStep = qr.occurredAt != null || payment.source === 'funnel_track';

    return this.buildJourneyView({
      params,
      signup,
      payment,
      qr,
      includeQrStep,
      funnelIdFallback: events[0]?.funnelId ?? null,
      timeline: [],
    });
  }

  private async loadCampaignActivities(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelPaymentId?: number | null;
  }): Promise<CustomerActivity[]> {
    const rows = await this.customerActivityRepository
      .createQueryBuilder('activity')
      .where('activity.business_id = :businessId', {
        businessId: params.businessId,
      })
      .andWhere('activity.customer_id = :customerId', {
        customerId: params.customerId,
      })
      .andWhere(
        `(
          (activity.metadata->>'campaignId')::int = :campaignId
          OR activity.metadata @> :campaignIdsJson
        )`,
        {
          campaignId: params.campaignId,
          campaignIdsJson: JSON.stringify({
            campaignIds: [params.campaignId],
          }),
        },
      )
      .orderBy('activity.created_at', 'ASC')
      .getMany();

    if (params.funnelPaymentId == null) {
      return rows;
    }

    return rows.filter((row) => {
      if (row.activityType === CustomerActivityType.ONLINE_SIGNUP) {
        return true;
      }
      const metaPaymentId = Number(row.metadata?.funnelPaymentId);
      const metaPaymentIds = Array.isArray(row.metadata?.funnelPaymentIds)
        ? (row.metadata!.funnelPaymentIds as unknown[]).map(Number)
        : [];
      if (
        metaPaymentId === params.funnelPaymentId ||
        metaPaymentIds.includes(params.funnelPaymentId!)
      ) {
        return true;
      }
      return row.activityType === CustomerActivityType.REDEMPTION;
    });
  }

  private buildJourneyFromActivities(
    params: {
      businessId: number;
      customerId: number;
      campaignId: number;
      funnelId?: number | null;
      funnelPaymentId?: number | null;
    },
    activities: CustomerActivity[],
    timeline: CustomerJourneyTimelineItem[],
  ): CustomerJourneyView {
    const signupRow =
      activities.find(
        (row) => row.activityType === CustomerActivityType.ONLINE_SIGNUP,
      ) ?? null;

    const purchaseRow =
      activities.find((row) => {
        if (
          row.activityType !== CustomerActivityType.ONLINE_PURCHASE &&
          row.activityType !== CustomerActivityType.IN_STORE_PURCHASE
        ) {
          return false;
        }
        if (params.funnelPaymentId == null) {
          return true;
        }
        const metaPaymentId = Number(row.metadata?.funnelPaymentId);
        const metaPaymentIds = Array.isArray(row.metadata?.funnelPaymentIds)
          ? (row.metadata!.funnelPaymentIds as unknown[]).map(Number)
          : [];
        return (
          metaPaymentId === params.funnelPaymentId ||
          metaPaymentIds.includes(params.funnelPaymentId!)
        );
      }) ?? null;

    const redemptionRow =
      activities.find(
        (row) => row.activityType === CustomerActivityType.REDEMPTION,
      ) ?? null;

    const signup: ResolvedStep = {
      event: null,
      occurredAt: signupRow?.createdAt ?? null,
      source: signupRow?.source ?? null,
    };
    const payment: ResolvedStep = {
      event: null,
      occurredAt: purchaseRow?.createdAt ?? null,
      source: purchaseRow?.source ?? null,
    };
    const qr: ResolvedStep = {
      event: null,
      occurredAt: redemptionRow?.createdAt ?? null,
      source: redemptionRow?.source ?? null,
    };

    const includeQrStep =
      qr.occurredAt != null ||
      purchaseRow?.activityType === CustomerActivityType.ONLINE_PURCHASE ||
      signupRow != null;

    const funnelIdFromMeta =
      activities
        .map((row) => Number(row.metadata?.funnelId))
        .find((id) => Number.isFinite(id) && id > 0) ?? null;

    return this.buildJourneyView({
      params,
      signup,
      payment,
      qr,
      includeQrStep,
      funnelIdFallback: funnelIdFromMeta,
      timeline,
    });
  }

  private buildJourneyView(input: {
    params: {
      customerId: number;
      campaignId: number;
      funnelId?: number | null;
      funnelPaymentId?: number | null;
    };
    signup: ResolvedStep;
    payment: ResolvedStep;
    qr: ResolvedStep;
    includeQrStep: boolean;
    funnelIdFallback: number | null;
    timeline: CustomerJourneyTimelineItem[];
  }): CustomerJourneyView {
    const { signup, payment, qr } = input;
    const resolved: Record<CustomerJourneyStep, ResolvedStep> = {
      [CustomerJourneyStep.SIGNUP]: signup,
      [CustomerJourneyStep.PAYMENT]: payment,
      [CustomerJourneyStep.QR_REDEEMED]: qr,
    };

    const stepsToShow = input.includeQrStep
      ? JOURNEY_STEPS
      : JOURNEY_STEPS.filter(
          (item) => item.step !== CustomerJourneyStep.QR_REDEEMED,
        );

    let foundCurrent = false;
    const steps: JourneyStepView[] = stepsToShow.map((item) => {
      const match = resolved[item.step];
      if (match.occurredAt) {
        return {
          step: item.step,
          label:
            item.step === CustomerJourneyStep.PAYMENT
              ? match.source === 'SCANNER' || match.source === 'scanner'
                ? 'Paid in store'
                : 'Paid'
              : item.label,
          state: 'complete' as const,
          occurredAt: match.occurredAt.toISOString(),
          source: match.source,
        };
      }

      if (!foundCurrent) {
        foundCurrent = true;
        return {
          step: item.step,
          label:
            item.step === CustomerJourneyStep.PAYMENT
              ? 'Payment Pending'
              : item.label,
          state: 'current' as const,
          occurredAt: null,
          source: null,
        };
      }

      return {
        step: item.step,
        label: item.label,
        state: 'pending' as const,
        occurredAt: null,
        source: null,
      };
    });

    const completedAt = [
      signup.occurredAt,
      payment.occurredAt,
      ...(input.includeQrStep ? [qr.occurredAt] : []),
    ].filter((value): value is Date => value != null);

    const lastUpdatedAt =
      completedAt.length > 0
        ? completedAt.reduce((latest, value) =>
            value > latest ? value : latest,
          )
        : null;

    return {
      customerId: input.params.customerId,
      campaignId: input.params.campaignId,
      funnelId: input.params.funnelId ?? input.funnelIdFallback,
      funnelPaymentId: input.params.funnelPaymentId ?? null,
      steps,
      timeline: input.timeline,
      lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
    };
  }

  private toTimelineItem(row: CustomerActivity): CustomerJourneyTimelineItem {
    const metaLabel =
      typeof row.metadata?.label === 'string' ? row.metadata.label : null;
    return {
      id: row.id,
      activityType: row.activityType,
      label: metaLabel ?? row.activityType,
      source: row.source,
      amount: row.amount,
      currency: row.currency,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private pickQrStepFromEventsOnly(
    events: CustomerJourneyEvent[],
    funnelPaymentId?: number | null,
  ): ResolvedStep {
    const isNonQrSource = (source: string | null | undefined) =>
      source === 'scanner_purchase' ||
      source === 'staff_lookup' ||
      source === 'backfill_payment_scope' ||
      source === 'backfill_customer_visit';

    if (funnelPaymentId == null) {
      const event =
        events.find(
          (row) =>
            row.step === CustomerJourneyStep.QR_REDEEMED &&
            !isNonQrSource(row.source),
        ) ?? null;
      return {
        event,
        occurredAt: event?.occurredAt ?? null,
        source: event?.source ?? null,
      };
    }

    const event =
      events.find(
        (row) =>
          row.step === CustomerJourneyStep.QR_REDEEMED &&
          !isNonQrSource(row.source) &&
          (row.refType === 'coupon' ||
            Number(row.metadata?.funnelPaymentId) === funnelPaymentId),
      ) ?? null;

    return {
      event,
      occurredAt: event?.occurredAt ?? null,
      source: event?.source ?? null,
    };
  }

  private pickSignupStep(events: CustomerJourneyEvent[]): ResolvedStep {
    const event =
      events.find((row) => row.step === CustomerJourneyStep.SIGNUP) ?? null;
    return {
      event,
      occurredAt: event?.occurredAt ?? null,
      source: event?.source ?? null,
    };
  }

  private pickPaymentStep(
    events: CustomerJourneyEvent[],
    funnelPaymentId?: number | null,
  ): ResolvedStep {
    if (funnelPaymentId != null) {
      const event =
        events.find(
          (row) =>
            row.step === CustomerJourneyStep.PAYMENT &&
            row.refType === 'funnel_payment' &&
            row.refId === String(funnelPaymentId),
        ) ?? null;
      return {
        event,
        occurredAt: event?.occurredAt ?? null,
        source: event?.source ?? null,
      };
    }

    const event =
      events.find((row) => row.step === CustomerJourneyStep.PAYMENT) ?? null;
    return {
      event,
      occurredAt: event?.occurredAt ?? null,
      source: event?.source ?? null,
    };
  }

  private async pickQrStep(
    events: CustomerJourneyEvent[],
    funnelPaymentId?: number | null,
  ): Promise<ResolvedStep> {
    const isNonQrSource = (source: string | null | undefined) =>
      source === 'scanner_purchase' ||
      source === 'staff_lookup' ||
      source === 'backfill_payment_scope' ||
      source === 'backfill_customer_visit';

    if (funnelPaymentId == null) {
      const event =
        events.find(
          (row) =>
            row.step === CustomerJourneyStep.QR_REDEEMED &&
            !isNonQrSource(row.source),
        ) ?? null;
      return {
        event,
        occurredAt: event?.occurredAt ?? null,
        source: event?.source ?? null,
      };
    }

    const coupon = await this.couponRepository.findOne({
      where: { funnelPaymentId },
      order: { createdAt: 'DESC' },
    });
    if (!coupon) {
      return { event: null, occurredAt: null, source: null };
    }

    const event =
      events.find(
        (row) =>
          row.step === CustomerJourneyStep.QR_REDEEMED &&
          !isNonQrSource(row.source) &&
          row.refType === 'coupon' &&
          row.refId === String(coupon.id),
      ) ??
      events.find((row) => {
        if (row.step !== CustomerJourneyStep.QR_REDEEMED) return false;
        if (isNonQrSource(row.source)) return false;
        const metaPaymentId = row.metadata?.funnelPaymentId;
        return Number(metaPaymentId) === funnelPaymentId;
      }) ??
      null;

    if (event) {
      return {
        event,
        occurredAt: event.occurredAt,
        source: event.source,
      };
    }

    const visit = await this.customerVisitRepository.findOne({
      where: { couponId: coupon.id },
      order: { visitedAt: 'DESC' },
    });
    if (visit) {
      if (visit.source === CustomerVisitSource.STAFF_LOOKUP) {
        return { event: null, occurredAt: null, source: null };
      }
      return {
        event: null,
        occurredAt: visit.visitedAt,
        source: 'customer_visit',
      };
    }

    if (coupon.redeemedAt != null || coupon.status === CouponStatus.REDEEMED) {
      return {
        event: null,
        occurredAt: coupon.redeemedAt ?? coupon.updatedAt ?? null,
        source: 'coupon_redeemed',
      };
    }

    return { event: null, occurredAt: null, source: null };
  }

  private async shouldIncludeQrJourneyStep(params: {
    funnelPaymentId?: number | null;
    payment: ResolvedStep;
    qr: ResolvedStep;
  }): Promise<boolean> {
    if (params.qr.occurredAt != null) {
      return true;
    }

    if (params.funnelPaymentId != null) {
      const payment = await this.funnelPaymentRepository.findOne({
        where: { id: params.funnelPaymentId },
      });
      if (payment?.paymentSource === FunnelPaymentSource.SCANNER) {
        return false;
      }

      const coupon = await this.couponRepository.findOne({
        where: { funnelPaymentId: params.funnelPaymentId },
        order: { createdAt: 'DESC' },
      });
      if (coupon) {
        const visit = await this.customerVisitRepository.findOne({
          where: { couponId: coupon.id },
          order: { visitedAt: 'DESC' },
        });
        if (visit?.source === CustomerVisitSource.STAFF_LOOKUP) {
          return false;
        }
      }
    }

    if (
      params.payment.source === 'scanner_purchase' ||
      params.payment.source === 'staff_lookup'
    ) {
      return false;
    }

    return true;
  }

  private async ensurePaymentScopedBackfill(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId?: number | null;
    funnelPaymentId?: number | null;
  }): Promise<void> {
    if (params.funnelPaymentId == null) {
      return;
    }

    let funnelId = params.funnelId ?? null;
    if (funnelId == null) {
      const funnel = await this.funnelRepository.findOne({
        where: { campaignId: params.campaignId },
      });
      funnelId = funnel?.id ?? null;
    }

    if (funnelId != null) {
      await this.recordPayment({
        businessId: params.businessId,
        customerId: params.customerId,
        campaignId: params.campaignId,
        funnelId,
        funnelPaymentId: params.funnelPaymentId,
        source: 'backfill_payment_scope',
      });
    }

    const coupon = await this.couponRepository.findOne({
      where: { funnelPaymentId: params.funnelPaymentId },
      order: { createdAt: 'DESC' },
    });
    if (!coupon) {
      return;
    }

    const visit = await this.customerVisitRepository.findOne({
      where: { couponId: coupon.id },
      order: { visitedAt: 'DESC' },
    });
    if (!visit || visit.source === CustomerVisitSource.STAFF_LOOKUP) {
      return;
    }

    await this.recordQrRedeemed({
      businessId: params.businessId,
      customerId: params.customerId,
      campaignId: params.campaignId,
      funnelId: funnelId ?? coupon.funnelId ?? null,
      couponId: coupon.id,
      funnelPaymentId: params.funnelPaymentId,
      occurredAt: visit.visitedAt,
      source: 'backfill_payment_scope',
    });
  }

  private async ensureBackfilled(params: {
    businessId: number;
    customerId: number;
    campaignId: number;
    funnelId?: number | null;
  }): Promise<void> {
    const existingCount = await this.journeyRepository.count({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
        campaignId: params.campaignId,
      },
    });
    if (existingCount > 0) {
      return;
    }

    let funnelId = params.funnelId ?? null;
    if (funnelId == null) {
      const funnel = await this.funnelRepository.findOne({
        where: { campaignId: params.campaignId },
      });
      funnelId = funnel?.id ?? null;
    }

    if (funnelId != null) {
      const funnelEvents = await this.funnelEventRepository.find({
        where: {
          funnelId,
          customerId: params.customerId,
        },
        order: { createdAt: 'ASC' },
      });

      for (const event of funnelEvents) {
        if (
          event.eventType === FunnelEventType.SIGNUP ||
          event.customerId != null
        ) {
          await this.recordSignup({
            businessId: params.businessId,
            customerId: params.customerId,
            campaignId: params.campaignId,
            funnelId,
            occurredAt: event.createdAt,
            source: 'backfill_funnel_event',
            funnelEventId: event.id,
          });
          break;
        }
      }

      for (const event of funnelEvents) {
        if (
          event.eventType === FunnelEventType.PAYMENT &&
          event.paymentStatus === FunnelPaymentStatus.PAID &&
          event.funnelPaymentId != null
        ) {
          await this.recordPayment({
            businessId: params.businessId,
            customerId: params.customerId,
            campaignId: params.campaignId,
            funnelId,
            funnelPaymentId: event.funnelPaymentId,
            occurredAt: event.createdAt,
            source: 'backfill_funnel_event',
          });
        }
      }
    }

    const visits = await this.customerVisitRepository.find({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
        campaignId: params.campaignId,
      },
      relations: { coupon: true },
      order: { visitedAt: 'ASC' },
    });

    for (const visit of visits) {
      if (visit.source === CustomerVisitSource.STAFF_LOOKUP) {
        continue;
      }
      if (visit.couponId == null) {
        continue;
      }
      await this.recordQrRedeemed({
        businessId: params.businessId,
        customerId: params.customerId,
        campaignId: params.campaignId,
        funnelId,
        couponId: visit.couponId,
        funnelPaymentId: visit.coupon?.funnelPaymentId ?? null,
        occurredAt: visit.visitedAt,
        source: 'backfill_customer_visit',
      });
    }
  }

  async resolveBusinessAndCampaignForFunnel(
    funnelId: number,
  ): Promise<{ businessId: number; campaignId: number } | null> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
      relations: { campaign: true },
    });
    if (!funnel?.campaign) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: funnel?.campaignId },
      });
      if (!funnel || !campaign) {
        return null;
      }
      return {
        businessId: campaign.businessId,
        campaignId: campaign.id,
      };
    }

    return {
      businessId: funnel.campaign.businessId,
      campaignId: funnel.campaign.id,
    };
  }
}
