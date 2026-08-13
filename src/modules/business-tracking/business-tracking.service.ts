import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessTracking } from '../../db/entities/business-tracking.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import {
  metaCampaignPermissionKeysFor,
} from '../member/member.constants';
import { UpsertBusinessTrackingDto } from './dto/upsert-business-tracking.dto';

export type BusinessTrackingResponse = {
  id: string;
  businessId: number;
  pixelId: string | null;
  googleTagManagerId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  hasAccessToken: boolean;
};

@Injectable()
export class BusinessTrackingService {
  constructor(
    @InjectRepository(BusinessTracking)
    private readonly trackingRepository: Repository<BusinessTracking>,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  private async assertMetaAccess(user: User, businessId: number) {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      metaCampaignPermissionKeysFor('view'),
      'You do not have permission to manage ads tracking for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }
    return business;
  }

  private toResponse(row: BusinessTracking): BusinessTrackingResponse {
    return {
      id: row.id,
      businessId: row.businessId,
      pixelId: row.pixelId,
      googleTagManagerId: row.googleTagManagerId,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      hasAccessToken: Boolean(row.accessToken?.trim()),
    };
  }

  private normalizeOptionalId(value?: string): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  }

  async getForBusiness(
    user: User,
    businessId: number,
  ): Promise<BusinessTrackingResponse | null> {
    await this.assertMetaAccess(user, businessId);

    const row = await this.trackingRepository.findOne({
      where: { businessId },
    });
    return row ? this.toResponse(row) : null;
  }

  async getActivePublicIdsForBusiness(businessId: number): Promise<{
    pixelId: string | null;
    googleTagManagerId: string | null;
  }> {
    if (!Number.isFinite(businessId) || businessId < 1) {
      return { pixelId: null, googleTagManagerId: null };
    }

    const row = await this.trackingRepository.findOne({
      where: { businessId, isActive: true },
    });

    return {
      pixelId: row?.pixelId?.trim() || null,
      googleTagManagerId: row?.googleTagManagerId?.trim() || null,
    };
  }

  async upsertForBusiness(
    user: User,
    businessId: number,
    dto: UpsertBusinessTrackingDto,
  ): Promise<BusinessTrackingResponse> {
    await this.assertMetaAccess(user, businessId);

    let row = await this.trackingRepository.findOne({
      where: { businessId },
    });

    if (!row) {
      row = this.trackingRepository.create({
        businessId,
        pixelId: null,
        accessToken: null,
        googleTagManagerId: null,
        isActive: true,
      });
    }

    if (dto.pixelId !== undefined) {
      row.pixelId = this.normalizeOptionalId(dto.pixelId);
    }
    if (dto.googleTagManagerId !== undefined) {
      row.googleTagManagerId = this.normalizeOptionalId(dto.googleTagManagerId);
    }
    if (dto.isActive !== undefined) {
      row.isActive = dto.isActive;
    }
    if (dto.accessToken !== undefined) {
      row.accessToken = this.normalizeOptionalId(dto.accessToken);
    }

    const saved = await this.trackingRepository.save(row);
    return this.toResponse(saved);
  }
}
