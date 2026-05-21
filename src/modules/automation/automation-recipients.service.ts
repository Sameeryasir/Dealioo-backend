import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
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
  ) {}

  async getUnpaidCustomersForFunnel(
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
      seenCustomerIds.add(customer.id);
      recipients.push({
        customerId: customer.id,
        email: customer.email,
        name: customer.name,
      });
    }

    return recipients;
  }
}
