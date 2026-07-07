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

    const paid = await this.funnelPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.funnelId = :funnelId', { funnelId })
      .andWhere('payment.status = :status', { status: FunnelPaymentStatus.PAID })
      .andWhere('LOWER(payment.customerEmail) = LOWER(:email)', {
        email: customer.email.trim(),
      })
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
    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .innerJoin(
        FunnelEvent,
        'event',
        'event.customerId = customer.id AND event.funnelId = :funnelId AND event.eventType = :signup',
        { funnelId, signup: FunnelEventType.SIGNUP },
      )
      .where(
        `NOT EXISTS (
          SELECT 1 FROM funnel_payment payment
          WHERE payment.funnel_id = :funnelId
            AND LOWER(payment.customer_email) = LOWER(customer.email)
            AND payment.status = :paidStatus
        )`,
        { funnelId, paidStatus: FunnelPaymentStatus.PAID },
      )
      .getMany();

    return customers.map((customer) => ({
      customerId: customer.id,
      email: customer.email,
      name: customer.name,
    }));
  }

  async findUnpaidPaymentRowCustomersForFunnel(
    funnelId: number,
  ): Promise<EmailRecipient[]> {
    const unpaidPayments = await this.funnelPaymentRepository.find({
      where: {
        funnelId,
        status: In([
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ]),
      },
      select: ['customerEmail'],
    });

    const normalizedEmails = [
      ...new Set(
        unpaidPayments
          .map((payment) => payment.customerEmail?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email)),
      ),
    ];

    if (normalizedEmails.length === 0) {
      return [];
    }

    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .where('LOWER(customer.email) IN (:...emails)', {
        emails: normalizedEmails,
      })
      .getMany();

    const recipients: EmailRecipient[] = [];
    const seenCustomerIds = new Set<number>();

    for (const customer of customers) {
      if (seenCustomerIds.has(customer.id)) {
        continue;
      }
      if (!(await this.isCustomerUnpaidOnFunnel(funnelId, customer.id))) {
        continue;
      }
      seenCustomerIds.add(customer.id);
      recipients.push({
        customerId: customer.id,
        email: customer.email,
        name: customer.name,
      });
    }

    return recipients;
  }

  async getUnpaidCustomersForFunnel(
    funnelId: number,
  ): Promise<EmailRecipient[]> {
    const [fromSignup, fromPaymentRows] = await Promise.all([
      this.findSignedUpUnpaidCustomersForFunnel(funnelId),
      this.findUnpaidPaymentRowCustomersForFunnel(funnelId),
    ]);

    const merged = new Map<number, EmailRecipient>();
    for (const recipient of [...fromSignup, ...fromPaymentRows]) {
      if (recipient.customerId == null) {
        continue;
      }
      merged.set(recipient.customerId, recipient);
    }

    return [...merged.values()];
  }

  async filterStillUnpaidRecipients(
    funnelId: number,
    recipients: EmailRecipient[],
  ): Promise<EmailRecipient[]> {
    const stillUnpaid: EmailRecipient[] = [];

    for (const recipient of recipients) {
      if (recipient.customerId == null) {
        continue;
      }
      if (await this.isCustomerUnpaidOnFunnel(funnelId, recipient.customerId)) {
        stillUnpaid.push(recipient);
      }
    }

    return stillUnpaid;
  }
}
