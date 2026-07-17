import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import type { EmailRecipient } from './automation-email.types';

export const UNPAID_RECIPIENT_PAGE_SIZE = 200;

export const UNPAID_SEND_CHUNK_SIZE = 50;

const UNPAID_PAYMENT_STATUSES = [
  FunnelPaymentStatus.PENDING,
  FunnelPaymentStatus.FAILED,
  FunnelPaymentStatus.CANCELLED,
] as const;

@Injectable()
export class AutomationRecipientsService {
  constructor(
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
  ) {}

  async isCustomerUnpaidOnFunnel(
    funnelId: number,
    customerId: number,
  ): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return false;
    }

    const email = customer.email.trim();
    const hasOpenCheckout = await this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.funnelId = :funnelId', { funnelId })
      .andWhere('payment.status IN (:...unpaidStatuses)', {
        unpaidStatuses: [...UNPAID_PAYMENT_STATUSES],
      })
      .andWhere('LOWER(payment.customerEmail) = LOWER(:email)', { email })
      .getExists();
    if (hasOpenCheckout) {
      return true;
    }

    const paid = await this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.funnelId = :funnelId', { funnelId })
      .andWhere('payment.status = :status', { status: FunnelPaymentStatus.PAID })
      .andWhere('LOWER(payment.customerEmail) = LOWER(:email)', { email })
      .getExists();

    return !paid;
  }

  async isSignedUpAndUnpaidOnFunnel(
    funnelId: number,
    customerId: number,
  ): Promise<boolean> {
    const signedUp = await this.funnelEventRepository.exist({
      where: {
        funnelId,
        customerId,
        eventType: FunnelEventType.SIGNUP,
      },
    });
    if (!signedUp) {
      return false;
    }

    return this.isCustomerUnpaidOnFunnel(funnelId, customerId);
  }

  async findSignedUpUnpaidCustomerIdsForFunnel(
    funnelId: number,
  ): Promise<number[]> {
    const recipients =
      await this.findSignedUpUnpaidCustomersForFunnel(funnelId);
    return recipients
      .map((recipient) => recipient.customerId)
      .filter((id): id is number => id != null);
  }

  async findSignedUpUnpaidCustomersForFunnel(
    funnelId: number,
  ): Promise<EmailRecipient[]> {
    return this.getUnpaidCustomersForFunnel(funnelId);
  }

  async getUnpaidCustomersForFunnelPage(
    funnelId: number,
    options: { afterCustomerId?: number; limit: number },
  ): Promise<EmailRecipient[]> {
    const afterCustomerId = Math.max(0, options.afterCustomerId ?? 0);
    const limit = Math.max(1, Math.min(options.limit, 500));

    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.id > :afterCustomerId', { afterCustomerId })
      .andWhere(this.unpaidRecipientWhereSql(), {
        funnelId,
        signup: FunnelEventType.SIGNUP,
        unpaidStatuses: [...UNPAID_PAYMENT_STATUSES],
        paidStatus: FunnelPaymentStatus.PAID,
      })
      .orderBy('customer.id', 'ASC')
      .take(limit)
      .getMany();

    return customers.map((customer) => ({
      customerId: customer.id,
      email: customer.email,
      name: customer.name,
    }));
  }

  async countUnpaidCustomersForFunnel(funnelId: number): Promise<number> {
    const raw = await this.customerRepository
      .createQueryBuilder('customer')
      .select('COUNT(customer.id)', 'count')
      .where(this.unpaidRecipientWhereSql(), {
        funnelId,
        signup: FunnelEventType.SIGNUP,
        unpaidStatuses: [...UNPAID_PAYMENT_STATUSES],
        paidStatus: FunnelPaymentStatus.PAID,
      })
      .getRawOne<{ count: string }>();

    return Number(raw?.count ?? 0);
  }

  async getCustomersByIds(customerIds: number[]): Promise<EmailRecipient[]> {
    const uniqueIds = [
      ...new Set(customerIds.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (uniqueIds.length === 0) {
      return [];
    }

    const customers = await this.customerRepository.find({
      where: { id: In(uniqueIds) },
    });

    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    return uniqueIds
      .map((id) => byId.get(id))
      .filter((customer): customer is Customer => Boolean(customer))
      .map((customer) => ({
        customerId: customer.id,
        email: customer.email,
        name: customer.name,
      }));
  }

  async findUnpaidPaymentRowCustomersForFunnel(
    funnelId: number,
  ): Promise<EmailRecipient[]> {
    return this.getUnpaidCustomersForFunnel(funnelId);
  }

  async getUnpaidCustomersForFunnel(
    funnelId: number,
  ): Promise<EmailRecipient[]> {
    const merged: EmailRecipient[] = [];
    let afterCustomerId = 0;

    while (true) {
      const page = await this.getUnpaidCustomersForFunnelPage(funnelId, {
        afterCustomerId,
        limit: UNPAID_RECIPIENT_PAGE_SIZE,
      });
      if (page.length === 0) {
        break;
      }
      merged.push(...page);
      afterCustomerId = page[page.length - 1]!.customerId!;
      if (page.length < UNPAID_RECIPIENT_PAGE_SIZE) {
        break;
      }
    }

    return merged;
  }

  async filterStillUnpaidRecipients(
    funnelId: number,
    recipients: EmailRecipient[],
  ): Promise<EmailRecipient[]> {
    const ids = recipients
      .map((recipient) => recipient.customerId)
      .filter((id): id is number => id != null && id > 0);

    if (ids.length === 0) {
      return [];
    }

    const unpaidIds = await this.findStillUnpaidCustomerIdsAmong(funnelId, ids);
    return recipients.filter(
      (recipient) =>
        recipient.customerId != null && unpaidIds.has(recipient.customerId),
    );
  }

  async findStillUnpaidCustomerIdsAmong(
    funnelId: number,
    customerIds: number[],
  ): Promise<Set<number>> {
    const uniqueIds = [
      ...new Set(customerIds.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (uniqueIds.length === 0) {
      return new Set();
    }

    const rows = await this.customerRepository
      .createQueryBuilder('customer')
      .select('customer.id', 'id')
      .where('customer.id IN (:...uniqueIds)', { uniqueIds })
      .andWhere(this.unpaidRecipientWhereSql(), {
        funnelId,
        signup: FunnelEventType.SIGNUP,
        unpaidStatuses: [...UNPAID_PAYMENT_STATUSES],
        paidStatus: FunnelPaymentStatus.PAID,
      })
      .getRawMany<{ id: string | number }>();

    return new Set(rows.map((row) => Number(row.id)));
  }

  private unpaidRecipientWhereSql(): string {
    return `(
      EXISTS (
        SELECT 1 FROM funnel_payment unpaid
        WHERE unpaid.funnel_id = :funnelId
          AND LOWER(unpaid.customer_email) = LOWER(customer.email)
          AND unpaid.status IN (:...unpaidStatuses)
      )
      OR (
        EXISTS (
          SELECT 1 FROM funnel_event event
          WHERE event.customer_id = customer.id
            AND event.funnel_id = :funnelId
            AND event.event_type = :signup
        )
        AND NOT EXISTS (
          SELECT 1 FROM funnel_payment payment
          WHERE payment.funnel_id = :funnelId
            AND LOWER(payment.customer_email) = LOWER(customer.email)
            AND payment.status = :paidStatus
        )
      )
    )`;
  }
}
