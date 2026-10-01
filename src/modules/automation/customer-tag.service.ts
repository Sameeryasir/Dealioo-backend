import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerTag } from '../../db/entities/customer-tag.entity';

const TAG_MAX_LENGTH = 64;

@Injectable()
export class CustomerTagService {
  constructor(
    @InjectRepository(CustomerTag)
    private readonly tagRepository: Repository<CustomerTag>,
  ) {}

  sanitizeTag(raw: unknown): string {
    const tag = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, TAG_MAX_LENGTH);
    if (!tag) {
      throw new BadRequestException('Tag name is required.');
    }
    return tag;
  }

  async applyTag(params: {
    businessId: number;
    customerId: number;
    tag: string;
    source?: string | null;
  }): Promise<{ tag: string; created: boolean }> {
    const tag = this.sanitizeTag(params.tag);
    const existing = await this.tagRepository.findOne({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
        tag,
      },
    });
    if (existing) {
      return { tag, created: false };
    }

    await this.tagRepository.insert({
      businessId: params.businessId,
      customerId: params.customerId,
      tag,
      source: params.source?.trim().slice(0, 64) || 'automation',
      createdByUserId: null,
    });
    return { tag, created: true };
  }

  async customerHasTag(params: {
    businessId: number;
    customerId: number;
    tag: string;
  }): Promise<boolean> {
    const tag = this.sanitizeTag(params.tag);
    return this.tagRepository.exist({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
        tag,
      },
    });
  }

  async listTagsForCustomer(params: {
    businessId: number;
    customerId: number;
  }): Promise<string[]> {
    const rows = await this.tagRepository.find({
      where: {
        businessId: params.businessId,
        customerId: params.customerId,
      },
      order: { tag: 'ASC' },
      take: 100,
    });
    return rows.map((row) => row.tag);
  }
}
