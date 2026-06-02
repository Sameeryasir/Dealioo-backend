import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { AutomationService } from '../automation/automation.service';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import {
  buildRecentMonthBuckets,
  type OverviewMonthBucket,
} from './overview-monthly.util';
@Injectable()
export class FunnelEventService {
  constructor(
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly automationService: AutomationService,
  ) {}

  async track(dto: TrackFunnelEventDto): Promise<FunnelEvent> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: dto.funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const tracked =
      dto.eventType === FunnelEventType.SIGNUP
        ? await this.trackSignup(dto)
        : await this.trackPayment(dto);

    if (tracked.shouldRunAutomation) {
      await this.automationService.handleEvent(tracked.event);
    }

    return tracked.event;
  }

  async getStats(funnelId: number): Promise<{
    funnelId: number;
    signups: number;
    payments: number;
    signupOnly: number;
    paidAfterSignup: number;
    revenue: number;
    currency: string | null;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const rows = await this.funnelEventRepository.find({
      where: { funnelId },
    });

    let signupOnly = 0;
    let paidAfterSignup = 0;

    for (const row of rows) {
      const signedUp = row.customerId !== null;
      const paid = row.funnelPaymentId !== null;

      if (!signedUp) {
        continue;
      }

      if (paid) {
        paidAfterSignup += 1;
      } else {
        signupOnly += 1;
      }
    }

    const paidPayments = await this.funnelPaymentRepository.find({
      where: { funnelId, status: FunnelPaymentStatus.PAID },
      select: ['amount', 'currency'],
    });

    let revenue = 0;
    let currency: string | null = null;

    for (const payment of paidPayments) {
      revenue += payment.amount;
      if (!currency && payment.currency) {
        currency = payment.currency;
      }
    }

    return {
      funnelId,
      signups: signupOnly + paidAfterSignup,
      payments: paidAfterSignup,
      signupOnly,
      paidAfterSignup,
      revenue,
      currency,
    };
  }

  async getStatsMonthly(
    funnelId: number,
    monthCount: number,
  ): Promise<{
    funnelId: number;
    months: number;
    currency: string | null;
    data: {
      month: string;
      signups: number;
      payments: number;
      signupOnly: number;
      paidAfterSignup: number;
      revenue: number;
    }[];
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const buckets = buildRecentMonthBuckets(monthCount);
    let currency: string | null = null;
    const data: {
      month: string;
      signups: number;
      payments: number;
      signupOnly: number;
      paidAfterSignup: number;
      revenue: number;
    }[] = [];

    for (const bucket of buckets) {
      const point = await this.aggregateStatsForMonth(funnelId, bucket);
      data.push(point);
      if (!currency && point.revenue > 0) {
        const sample = await this.funnelPaymentRepository.findOne({
          where: {
            funnelId,
            status: FunnelPaymentStatus.PAID,
            createdAt: And(
              MoreThanOrEqual(bucket.start),
              LessThan(bucket.end),
            ),
          },
          select: ['currency'],
        });
        currency = sample?.currency ?? null;
      }
    }

    if (!currency) {
      const anyPaid = await this.funnelPaymentRepository.findOne({
        where: { funnelId, status: FunnelPaymentStatus.PAID },
        select: ['currency'],
      });
      currency = anyPaid?.currency ?? null;
    }

    return { funnelId, months: monthCount, currency, data };
  }

  private async aggregateStatsForMonth(
    funnelId: number,
    bucket: OverviewMonthBucket,
  ): Promise<{
    month: string;
    signups: number;
    payments: number;
    signupOnly: number;
    paidAfterSignup: number;
    revenue: number;
  }> {
    const createdInMonth = And(
      MoreThanOrEqual(bucket.start),
      LessThan(bucket.end),
    );

    const rows = await this.funnelEventRepository.find({
      where: { funnelId, createdAt: createdInMonth },
    });

    let signupOnly = 0;
    let paidAfterSignup = 0;

    for (const row of rows) {
      if (row.customerId === null) {
        continue;
      }
      if (row.funnelPaymentId !== null) {
        paidAfterSignup += 1;
      } else {
        signupOnly += 1;
      }
    }

    const paidPayments = await this.funnelPaymentRepository.find({
      where: {
        funnelId,
        status: FunnelPaymentStatus.PAID,
        createdAt: createdInMonth,
      },
      select: ['amount'],
    });

    let revenue = 0;
    for (const payment of paidPayments) {
      revenue += payment.amount;
    }

    const payments = paidPayments.length;

    return {
      month: bucket.month,
      signups: signupOnly + paidAfterSignup,
      payments,
      signupOnly,
      paidAfterSignup,
      revenue,
    };
  }

  private async trackSignup(
    dto: TrackFunnelEventDto,
  ): Promise<{ event: FunnelEvent; shouldRunAutomation: boolean }> {
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required for signup events');
    }

    const customerId = await this.resolveCustomerId(dto.customerId);
    if (customerId === null) {
      throw new NotFoundException('Customer not found.');
    }

    const visitorId = dto.visitorId?.trim() ?? null;
    const existing = await this.findRowByFunnelAndCustomer(
      dto.funnelId,
      customerId,
    );

    if (existing) {
      existing.eventType = FunnelEventType.SIGNUP;
      existing.customerId = customerId;
      if (visitorId) {
        existing.visitorId = visitorId;
      }
      return {
        event: await this.funnelEventRepository.save(existing),
        shouldRunAutomation: false,
      };
    }

    const event = this.funnelEventRepository.create({
      funnelId: dto.funnelId,
      eventType: FunnelEventType.SIGNUP,
      customerId,
      visitorId,
    });

    return {
      event: await this.funnelEventRepository.save(event),
      shouldRunAutomation: true,
    };
  }

  private async trackPayment(
    dto: TrackFunnelEventDto,
  ): Promise<{ event: FunnelEvent; shouldRunAutomation: boolean }> {
    let payment: FunnelPayment | null = null;

    if (dto.funnelPaymentId) {
      payment = await this.funnelPaymentRepository.findOne({
        where: { id: dto.funnelPaymentId, funnelId: dto.funnelId },
      });
      if (!payment) {
        throw new NotFoundException(
          'Funnel payment not found for this funnel',
        );
      }
    } else if (dto.stripePaymentIntentId) {
      payment = await this.funnelPaymentRepository.findOne({
        where: {
          stripePaymentIntentId: dto.stripePaymentIntentId,
          funnelId: dto.funnelId,
        },
      });
    }

    if (!dto.customerId) {
      throw new BadRequestException('customerId is required for payment events');
    }

    const customerId = await this.resolveCustomerId(dto.customerId);
    if (customerId === null) {
      throw new NotFoundException('Customer not found.');
    }

    const visitorId = dto.visitorId?.trim() ?? null;
    const existing = await this.findRowByFunnelAndCustomer(
      dto.funnelId,
      customerId,
    );

    const funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? null;

    if (existing) {
      const wasPaidBefore = this.isPaidFunnelEvent(existing);
      existing.customerId = customerId;
      if (visitorId) {
        existing.visitorId = visitorId;
      }
      this.applyPaymentFieldsToRow(existing, dto, payment);
      const event = await this.funnelEventRepository.save(existing);
      const isPaidNow = this.isPaidFunnelEvent(event);
      return {
        event,
        shouldRunAutomation: !wasPaidBefore && isPaidNow,
      };
    }

    const event = this.funnelEventRepository.create({
      funnelId: dto.funnelId,
      eventType: FunnelEventType.PAYMENT,
      customerId,
      visitorId,
      funnelPaymentId,
      amount: dto.amount ?? payment?.amount ?? null,
      currency: dto.currency ?? payment?.currency ?? null,
      paymentStatus: dto.paymentStatus ?? payment?.status ?? null,
      stripePaymentIntentId:
        dto.stripePaymentIntentId ?? payment?.stripePaymentIntentId ?? null,
      customerEmail: dto.customerEmail ?? payment?.customerEmail ?? null,
      receiptUrl: dto.receiptUrl ?? payment?.receiptUrl ?? null,
    });

    const saved = await this.funnelEventRepository.save(event);
    return {
      event: saved,
      shouldRunAutomation: this.isPaidFunnelEvent(saved),
    };
  }

  private isPaidFunnelEvent(event: FunnelEvent): boolean {
    if (event.paymentStatus === FunnelPaymentStatus.PAID) {
      return true;
    }
    return event.funnelPaymentId !== null && event.funnelPaymentId !== undefined;
  }

  private applyPaymentFieldsToRow(
    row: FunnelEvent,
    dto: TrackFunnelEventDto,
    payment: FunnelPayment | null,
  ): void {
    row.eventType = FunnelEventType.PAYMENT;
    row.funnelPaymentId = payment?.id ?? dto.funnelPaymentId ?? row.funnelPaymentId;
    row.amount = dto.amount ?? payment?.amount ?? row.amount;
    row.currency = dto.currency ?? payment?.currency ?? row.currency;
    row.paymentStatus = dto.paymentStatus ?? payment?.status ?? row.paymentStatus;
    row.stripePaymentIntentId =
      dto.stripePaymentIntentId ??
      payment?.stripePaymentIntentId ??
      row.stripePaymentIntentId;
    row.customerEmail =
      dto.customerEmail ?? payment?.customerEmail ?? row.customerEmail;
    row.receiptUrl = dto.receiptUrl ?? payment?.receiptUrl ?? row.receiptUrl;
  }

  private async findRowByFunnelAndCustomer(
    funnelId: number,
    customerId: number,
  ): Promise<FunnelEvent | null> {
    return this.funnelEventRepository.findOne({
      where: { funnelId, customerId },
    });
  }

  private async resolveCustomerId(
    customerId: number,
  ): Promise<number | null> {
    const exists = await this.customerRepository.exist({
      where: { id: customerId },
    });
    return exists ? customerId : null;
  }

}
