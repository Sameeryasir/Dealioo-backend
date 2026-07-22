import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { BusinessCustomer } from '../../db/entities/business-customer.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { AutomationQueueService } from '../automation/automation-queue.service';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';

export type BusinessCustomerListItem = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  joiningDate: string;
  visitCount: number;
};

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(BusinessCustomer)
    private readonly businessCustomerRepository: Repository<BusinessCustomer>,
    @InjectRepository(AutomationExecution)
    private readonly automationExecutionRepository: Repository<AutomationExecution>,
    private readonly dataSource: DataSource,
    private readonly automationQueueService: AutomationQueueService,
  ) {}


  async listForBusiness(
    businessId: number,
    page?: number,
    limit?: number,
  ): Promise<{ data: BusinessCustomerListItem[]; meta: PaginationMeta }> {
    const pagination = normalizePagination(page, limit);

    const total = await this.businessCustomerRepository.count({
      where: { businessId },
    });

    if (total === 0) {
      return {
        data: [],
        meta: buildPaginationMeta(0, pagination.page, pagination.limit),
      };
    }

    const rows = await this.businessCustomerRepository
      .createQueryBuilder('link')
      .innerJoin('link.customer', 'customer')
      .where('link.businessId = :businessId', { businessId })
      .select('customer.id', 'id')
      .addSelect('customer.name', 'name')
      .addSelect('customer.email', 'email')
      .addSelect('customer.phone', 'phone')
      .addSelect('link.joinedAt', 'joiningDate')
      .addSelect(
        `COALESCE((
          SELECT COUNT(visit.id)
          FROM customer_visits visit
          WHERE visit.customer_id = "link"."customer_id"
            AND visit.restaurant_id = "link"."business_id"
        ), 0)`,
        'visitCount',
      )
      .orderBy('link.joinedAt', 'DESC')
      .offset(pagination.skip)
      .limit(pagination.limit)
      .getRawMany<{
        id: string | number;
        name: string;
        email: string;
        phone: string | null;
        joiningDate: Date | string;
        visitCount: string | number;
      }>();

    return {
      data: rows.map((row) => ({
        id: Number(row.id),
        name: row.name?.trim() || 'Guest',
        email: row.email,
        phone: row.phone,
        joiningDate:
          row.joiningDate instanceof Date
            ? row.joiningDate.toISOString()
            : new Date(row.joiningDate).toISOString(),
        visitCount: Number(row.visitCount) || 0,
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getJoiningTrendForBusiness(
    businessId: number,
    months = 6,
  ): Promise<{ label: string; monthKey: string; joined: number }[]> {
    const monthCount = Math.min(Math.max(months, 1), 24);
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCMonth(start.getUTCMonth() - (monthCount - 1));

    const rows = await this.businessCustomerRepository
      .createQueryBuilder('link')
      .select(`TO_CHAR(DATE_TRUNC('month', link.joinedAt), 'YYYY-MM')`, 'monthKey')
      .addSelect('COUNT(link.id)', 'joined')
      .where('link.businessId = :businessId', { businessId })
      .andWhere('link.joinedAt >= :start', { start })
      .groupBy(`DATE_TRUNC('month', link.joinedAt)`)
      .orderBy(`DATE_TRUNC('month', link.joinedAt)`, 'ASC')
      .getRawMany<{ monthKey: string; joined: string }>();

    const countByMonth = new Map(
      rows.map((row) => [row.monthKey, Number(row.joined) || 0]),
    );

    const points: { label: string; monthKey: string; joined: number }[] = [];
    for (let i = 0; i < monthCount; i += 1) {
      const cursor = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
      );
      const monthKey = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = cursor.toLocaleString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
      points.push({
        label,
        monthKey,
        joined: countByMonth.get(monthKey) ?? 0,
      });
    }

    return points;
  }

  async ensureBusinessCustomerLink(
    businessId: number,
    customerId: number,
    joinedAt: Date = new Date(),
  ): Promise<BusinessCustomer> {
    const existing = await this.businessCustomerRepository.findOne({
      where: { businessId, customerId },
    });
    if (existing) {
      return existing;
    }

    try {
      const link = this.businessCustomerRepository.create({
        businessId,
        customerId,
        joinedAt,
      });
      return await this.businessCustomerRepository.save(link);
    } catch {
      const raced = await this.businessCustomerRepository.findOne({
        where: { businessId, customerId },
      });
      if (raced) return raced;
      throw new NotFoundException('Could not link guest to business.');
    }
  }

  async findAllPaginated(
    page?: number,
    limit?: number,
  ): Promise<{ data: Customer[]; meta: PaginationMeta }> {
    const pagination = normalizePagination(page, limit);

    const [data, total] = await this.customerRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async registerCustomer(dto: RegisterCustomerDto): Promise<Customer> {
    const email = dto.email.trim();
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || null;

    const existing = await this.customerRepository
      .createQueryBuilder('customer')
      .where('LOWER(customer.email) = LOWER(:email)', { email })
      .orderBy('customer.id', 'DESC')
      .getOne();

    if (existing) {
      if (dto.rejectDuplicateEmail) {
        throw new ConflictException(
          'A guest with this email already exists. Search for them instead.',
        );
      }

      let changed = false;
      if (name && existing.name !== name) {
        existing.name = name;
        changed = true;
      }
      if (phone !== null && existing.phone !== phone) {
        existing.phone = phone;
        changed = true;
      }
      return changed ? this.customerRepository.save(existing) : existing;
    }

    const customer = this.customerRepository.create({
      name,
      email,
      phone,
    });

    return this.customerRepository.save(customer);
  }

  async searchCustomers(
    query: string,
    page?: number,
    limit?: number,
  ): Promise<{ data: Customer[]; meta: PaginationMeta }> {
    const trimmed = query.trim();
    const pagination = normalizePagination(page, limit);

    if (!trimmed || trimmed.length < 2) {
      return {
        data: [],
        meta: buildPaginationMeta(0, pagination.page, pagination.limit),
      };
    }

    const escaped = trimmed.replace(/[%_\\]/g, '\\$&');
    const prefixPattern = `${escaped}%`;
    const containsPattern = `%${escaped}%`;
    const digitsOnly = trimmed.replace(/\D/g, '');

    const qb = this.customerRepository
      .createQueryBuilder('customer')
      .select([
        'customer.id',
        'customer.name',
        'customer.email',
        'customer.phone',
      ])
      .where(
        new Brackets((sub) => {
          sub
            .where('customer.email ILIKE :prefixPattern', { prefixPattern })
            .orWhere('customer.name ILIKE :containsPattern', {
              containsPattern,
            });

          if (digitsOnly.length >= 3) {
            sub.orWhere(
              "REGEXP_REPLACE(COALESCE(customer.phone, ''), '[^0-9]', '', 'g') LIKE :phoneDigits",
              { phoneDigits: `%${digitsOnly}%` },
            );
          } else {
            sub.orWhere("COALESCE(customer.phone, '') ILIKE :containsPattern", {
              containsPattern,
            });
          }
        }),
      )
      .orderBy('customer.name', 'ASC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async findById(id: number): Promise<Customer> {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Guest not found');
    }
    return customer;
  }

  async deleteCustomer(id: number): Promise<void> {
    const customer = await this.findById(id);

    const executions = await this.automationExecutionRepository.find({
      where: { customerId: id },
      select: ['id'],
    });
    const executionIds = executions.map((execution) => execution.id);

    await this.automationQueueService.purgeExecutionJobs(executionIds);

    await this.dataSource.transaction(async (manager) => {
      const coupons = await manager.find(Coupon, {
        where: { customerId: id },
        select: ['id'],
      });
      const couponIds = coupons.map((coupon) => coupon.id);

      await manager.delete(BusinessCustomer, { customerId: id });
      await manager.delete(CustomerVisit, { customerId: id });

      if (couponIds.length > 0) {
        await manager.delete(RedemptionLog, { couponId: In(couponIds) });
        await manager.delete(CustomerVisit, { couponId: In(couponIds) });
      }

      await manager.delete(RedemptionLog, { customerId: id });
      await manager.delete(Coupon, { customerId: id });
      await manager.delete(AutomationLog, { customerId: id });
      await manager.delete(AutomationExecution, { customerId: id });
      await manager.delete(FunnelEvent, { customerId: id });
      await manager.delete(CheckoutAccessToken, { customerId: id });

      const payments = await manager
        .createQueryBuilder(FunnelPayment, 'payment')
        .select(['payment.id'])
        .where('LOWER(payment.customerEmail) = LOWER(:email)', {
          email: customer.email.trim(),
        })
        .getMany();
      const paymentIds = payments.map((payment) => payment.id);

      if (paymentIds.length > 0) {
        await manager.delete(FunnelEvent, { funnelPaymentId: In(paymentIds) });
        await manager.delete(CheckoutAccessToken, {
          funnelPaymentId: In(paymentIds),
        });
        await manager.delete(FunnelPayment, { id: In(paymentIds) });
      }

      await manager.delete(Customer, { id });
    });
  }
}
