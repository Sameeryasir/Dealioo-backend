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
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { AutomationQueueService } from '../automation/automation-queue.service';
import { RegisterCustomerDto } from './customerDto/register-customer.dto';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(AutomationExecution)
    private readonly automationExecutionRepository: Repository<AutomationExecution>,
    private readonly dataSource: DataSource,
    private readonly automationQueueService: AutomationQueueService,
  ) {}

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
    const existing = await this.customerRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('A customer with this email already exists');
    }

    const customer = this.customerRepository.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone?.trim() || null,
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
            sub.orWhere('COALESCE(customer.phone, \'\') ILIKE :containsPattern', {
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
    await this.findById(id);

    const executions = await this.automationExecutionRepository.find({
      where: { customerId: id },
      select: ['id'],
    });
    const executionIds = executions.map((execution) => execution.id);

    // Stop queued automation jobs before removing execution rows.
    await this.automationQueueService.purgeExecutionJobs(executionIds);

    await this.dataSource.transaction(async (manager) => {
      const coupons = await manager.find(Coupon, {
        where: { customerId: id },
        select: ['id'],
      });
      const couponIds = coupons.map((coupon) => coupon.id);

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
      await manager.delete(Customer, { id });
    });
  }
}
