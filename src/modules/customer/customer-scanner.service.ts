import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Customer } from '../../db/entities/customer.entity';
import { CustomerService } from './customer.service';
import { ScannerCreateGuestDto } from './customerDto/scanner-create-guest.dto';

export type ScannerGuestSearchResult = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
};

@Injectable()
export class CustomerScannerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly customerService: CustomerService,
  ) {}

  static readonly SEARCH_PAGE_SIZE = 10;

  async searchGuestsForBusiness(
    businessId: number,
    query: string,
    page?: number,
    _limit?: number,
  ): Promise<{ data: ScannerGuestSearchResult[]; meta: PaginationMeta }> {
    const trimmed = query.trim();
    const pagination = normalizePagination(
      page,
      CustomerScannerService.SEARCH_PAGE_SIZE,
    );

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
      .andWhere(
        new Brackets((scope) => {
          scope
            .where(
              `EXISTS (
                SELECT 1 FROM business_customers bc
                WHERE bc.customer_id = customer.id
                  AND bc.business_id = :businessId
              )`,
            )
            .orWhere(
              `EXISTS (
                SELECT 1 FROM coupons coupon
                WHERE coupon.customer_id = customer.id
                  AND coupon.business_id = :businessId
                  AND coupon.deleted_at IS NULL
              )`,
            )
            .orWhere(
              `EXISTS (
                SELECT 1 FROM customer_visits visit
                WHERE visit.customer_id = customer.id
                  AND visit.business_id = :businessId
                  AND visit.deleted_at IS NULL
              )`,
            )
            .orWhere(
              `EXISTS (
                SELECT 1 FROM funnel_payment payment
                WHERE payment.customer_id = customer.id
                  AND payment.business_id = :businessId
              )`,
            );
        }),
      )
      .setParameter('businessId', businessId)
      .orderBy('customer.name', 'ASC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async createGuestForBusiness(
    businessId: number,
    dto: ScannerCreateGuestDto,
  ): Promise<Customer & { isNewCustomer: boolean }> {
    return this.customerService.registerCustomer({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      rejectDuplicateEmail: true,
      rejectDuplicatePhone: true,
      businessId,
    });
  }
}
