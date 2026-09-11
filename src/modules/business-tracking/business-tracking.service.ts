import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessTracking } from '../../db/entities/business-tracking.entity';
import { User } from '../../db/entities/user.entity';
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import { BusinessAccessService } from '../business-access/business-access.service';
import { metaCampaignPermissionKeysFor } from '../member/member.constants';
import { UpsertBusinessTrackingDto } from './dto/upsert-business-tracking.dto';

export type BusinessTrackingResponse = {
  id: string;
  businessId: number;
  pixelId: string | null;
  googleTagManagerId: string | null;
  googleAdsSignupConversionLabel: string | null;
  googleAdsPurchaseConversionLabel: string | null;
  googleAdsLeadConversionLabel: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  hasAccessToken: boolean;
  hasCapiReady: boolean;
  capiCredentialSource: 'tracking_token' | 'meta_oauth' | null;
};

export type ActivePublicTrackingIds = {
  pixelId: string | null;
  googleTagManagerId: string | null;
  googleAdsSignupConversionLabel: string | null;
  googleAdsPurchaseConversionLabel: string | null;
  googleAdsLeadConversionLabel: string | null;
};

export type BusinessCapiCredentials = {
  pixelId: string;
  accessToken: string;
  source: 'tracking_token' | 'meta_oauth';
};

@Injectable()
export class BusinessTrackingService {
  private readonly logger = new Logger(BusinessTrackingService.name);

  constructor(
    @InjectRepository(BusinessTracking)
    private readonly trackingRepository: Repository<BusinessTracking>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
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

  private resolveMetaOauthToken(business: Business | null): string | null {
    const stored = business?.metaAccessToken?.trim();
    if (!stored) return null;
    try {
      const decrypted = decryptSecret(stored)?.trim();
      return decrypted || null;
    } catch (err) {
      this.logger.warn(
        `Could not decrypt Meta OAuth token for CAPI businessId=${business?.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async toResponse(
    row: BusinessTracking,
  ): Promise<BusinessTrackingResponse> {
    const credentials = await this.getCapiCredentials(row.businessId);
    return {
      id: row.id,
      businessId: row.businessId,
      pixelId: row.pixelId,
      googleTagManagerId: row.googleTagManagerId,
      googleAdsSignupConversionLabel: row.googleAdsSignupConversionLabel,
      googleAdsPurchaseConversionLabel: row.googleAdsPurchaseConversionLabel,
      googleAdsLeadConversionLabel: row.googleAdsLeadConversionLabel,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      hasAccessToken: Boolean(row.accessToken?.trim()),
      hasCapiReady: Boolean(credentials),
      capiCredentialSource: credentials?.source ?? null,
    };
  }

  private normalizeOptionalId(value?: string): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  }

  async getCapiCredentials(
    businessId: number,
  ): Promise<BusinessCapiCredentials | null> {
    if (!Number.isFinite(businessId) || businessId < 1) return null;

    const tracking = await this.trackingRepository.findOne({
      where: { businessId, isActive: true },
    });
    const pixelId = tracking?.pixelId?.trim() || null;
    if (!pixelId) return null;

    const dedicatedRaw = tracking?.accessToken?.trim();
    if (dedicatedRaw) {
      try {
        const dedicated = decryptSecret(dedicatedRaw)?.trim();
        if (dedicated) {
          return {
            pixelId,
            accessToken: dedicated,
            source: 'tracking_token',
          };
        }
      } catch (err) {
        this.logger.warn(
          `Could not decrypt tracking CAPI token businessId=${businessId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      select: ['id', 'metaAccessToken'],
    });
    const oauthToken = this.resolveMetaOauthToken(business);
    if (!oauthToken) return null;

    return {
      pixelId,
      accessToken: oauthToken,
      source: 'meta_oauth',
    };
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

  async getActivePublicIdsForBusiness(
    businessId: number,
  ): Promise<ActivePublicTrackingIds> {
    if (!Number.isFinite(businessId) || businessId < 1) {
      return {
        pixelId: null,
        googleTagManagerId: null,
        googleAdsSignupConversionLabel: null,
        googleAdsPurchaseConversionLabel: null,
        googleAdsLeadConversionLabel: null,
      };
    }

    const row = await this.trackingRepository.findOne({
      where: { businessId, isActive: true },
    });

    return {
      pixelId: row?.pixelId?.trim() || null,
      googleTagManagerId: row?.googleTagManagerId?.trim() || null,
      googleAdsSignupConversionLabel:
        row?.googleAdsSignupConversionLabel?.trim() || null,
      googleAdsPurchaseConversionLabel:
        row?.googleAdsPurchaseConversionLabel?.trim() || null,
      googleAdsLeadConversionLabel:
        row?.googleAdsLeadConversionLabel?.trim() || null,
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
        googleAdsSignupConversionLabel: null,
        googleAdsPurchaseConversionLabel: null,
        googleAdsLeadConversionLabel: null,
        isActive: true,
      });
    }

    if (dto.pixelId !== undefined) {
      row.pixelId = this.normalizeOptionalId(dto.pixelId);
    }
    if (dto.googleTagManagerId !== undefined) {
      row.googleTagManagerId = this.normalizeOptionalId(dto.googleTagManagerId);
    }
    if (dto.googleAdsSignupConversionLabel !== undefined) {
      row.googleAdsSignupConversionLabel = this.normalizeOptionalId(
        dto.googleAdsSignupConversionLabel,
      );
    }
    if (dto.googleAdsPurchaseConversionLabel !== undefined) {
      row.googleAdsPurchaseConversionLabel = this.normalizeOptionalId(
        dto.googleAdsPurchaseConversionLabel,
      );
    }
    if (dto.googleAdsLeadConversionLabel !== undefined) {
      row.googleAdsLeadConversionLabel = this.normalizeOptionalId(
        dto.googleAdsLeadConversionLabel,
      );
    }
    if (dto.isActive !== undefined) {
      row.isActive = dto.isActive;
    }
    if (dto.accessToken !== undefined) {
      const normalized = this.normalizeOptionalId(dto.accessToken);
      row.accessToken = normalized ? encryptSecret(normalized) : null;
    }

    const saved = await this.trackingRepository.save(row);
    return this.toResponse(saved);
  }
}
