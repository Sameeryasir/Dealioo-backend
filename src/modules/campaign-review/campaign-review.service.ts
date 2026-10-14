import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/pagination';
import {
  CampaignReview,
  CampaignReviewStatus,
} from '../../db/entities/campaign-review.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { buildCampaignFeedbackUrl } from '../../utils/campaign-feedback-url';

const FEEDBACK_TOKEN_TTL_DAYS = 30;
const MAX_COMMENT_LENGTH = 2000;

export type CreateCampaignReviewRequestInput = {
  businessId: number;
  campaignId: number;
  funnelId?: number | null;
  customerId: number;
  automationId?: number | null;
  executionId?: number | null;
  nodeId?: number | null;
  guestName?: string | null;
  guestEmail?: string | null;
};

export type CampaignReviewListItem = {
  id: number;
  rating: number;
  comment: string | null;
  guestName: string | null;
  guestEmail: string | null;
  submittedAt: string;
  createdAt: string;
};

export type CampaignReviewSummary = {
  totalReviews: number;
  averageRating: number | null;
  requestsSent: number;
};

@Injectable()
export class CampaignReviewService {
  constructor(
    @InjectRepository(CampaignReview)
    private readonly reviewRepository: Repository<CampaignReview>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async hasSubmittedReviewForCampaign(
    campaignId: number,
    customerId: number,
  ): Promise<boolean> {
    if (!campaignId || campaignId < 1 || !customerId || customerId < 1) {
      return false;
    }

    const count = await this.reviewRepository.count({
      where: {
        campaignId,
        customerId,
        status: CampaignReviewStatus.SUBMITTED,
      },
    });
    return count > 0;
  }

  async createFeedbackRequest(
    input: CreateCampaignReviewRequestInput,
  ): Promise<{ token: string; feedbackUrl: string; reviewId: number }> {
    if (!input.campaignId || input.campaignId < 1) {
      throw new BadRequestException('Campaign is required for feedback');
    }
    if (!input.customerId || input.customerId < 1) {
      throw new BadRequestException('Customer is required for feedback');
    }

    const campaign = await this.campaignRepository.findOne({
      where: { id: input.campaignId, businessId: input.businessId },
      select: ['id'],
    });
    if (!campaign) {
      throw new BadRequestException('Campaign not found for this business');
    }

    if (
      await this.hasSubmittedReviewForCampaign(
        input.campaignId,
        input.customerId,
      )
    ) {
      throw new BadRequestException(
        'This guest already submitted a review for this campaign.',
      );
    }

    await this.reviewRepository
      .createQueryBuilder()
      .update(CampaignReview)
      .set({ status: CampaignReviewStatus.EXPIRED })
      .where('campaign_id = :campaignId', { campaignId: input.campaignId })
      .andWhere('customer_id = :customerId', { customerId: input.customerId })
      .andWhere('status = :pending', {
        pending: CampaignReviewStatus.PENDING,
      })
      .execute();

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + FEEDBACK_TOKEN_TTL_DAYS);

    const row = await this.reviewRepository.save(
      this.reviewRepository.create({
        tokenHash,
        businessId: input.businessId,
        campaignId: input.campaignId,
        funnelId: input.funnelId ?? null,
        customerId: input.customerId,
        automationId: input.automationId ?? null,
        executionId: input.executionId ?? null,
        nodeId: input.nodeId ?? null,
        status: CampaignReviewStatus.PENDING,
        rating: null,
        comment: null,
        guestName: this.sanitizePlainText(input.guestName, 255),
        guestEmail: this.sanitizeEmail(input.guestEmail),
        expiresAt,
        submittedAt: null,
      }),
    );

    return {
      token,
      feedbackUrl: buildCampaignFeedbackUrl(token),
      reviewId: row.id,
    };
  }

  async getPublicFeedback(token: string): Promise<{
    campaignName: string;
    guestName: string | null;
    status: CampaignReviewStatus;
    alreadySubmitted: boolean;
    expired: boolean;
  }> {
    const row = await this.loadByToken(token);
    const campaign = await this.campaignRepository.findOne({
      where: { id: row.campaignId },
      select: ['id', 'campaignName'],
    });

    const expired =
      row.status === CampaignReviewStatus.EXPIRED ||
      row.expiresAt.getTime() <= Date.now();
    const alreadySubmitted = row.status === CampaignReviewStatus.SUBMITTED;

    return {
      campaignName: this.sanitizePlainText(
        campaign?.campaignName?.trim() || 'this campaign',
        120,
      )!,
      guestName: expired ? null : this.toPublicGuestName(row.guestName),
      status: expired ? CampaignReviewStatus.EXPIRED : row.status,
      alreadySubmitted,
      expired,
    };
  }

  async submitPublicFeedback(
    token: string,
    input: { rating: number; comment?: string },
  ): Promise<{ ok: true }> {
    const row = await this.loadByToken(token);
    const now = new Date();

    if (
      row.status === CampaignReviewStatus.EXPIRED ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      if (row.status !== CampaignReviewStatus.EXPIRED) {
        await this.reviewRepository.update(row.id, {
          status: CampaignReviewStatus.EXPIRED,
        });
      }
      throw new BadRequestException('This feedback link has expired.');
    }

    if (row.status === CampaignReviewStatus.SUBMITTED) {
      throw new BadRequestException('Feedback was already submitted.');
    }

    const rating = Math.floor(Number(input.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5.');
    }

    const comment = this.sanitizePlainText(input.comment, MAX_COMMENT_LENGTH);

    const updateResult = await this.reviewRepository
      .createQueryBuilder()
      .update(CampaignReview)
      .set({
        rating,
        comment,
        status: CampaignReviewStatus.SUBMITTED,
        submittedAt: now,
      })
      .where('id = :id', { id: row.id })
      .andWhere('status = :pending', {
        pending: CampaignReviewStatus.PENDING,
      })
      .andWhere('expires_at > :now', { now })
      .execute();

    if (!updateResult.affected || updateResult.affected < 1) {
      const latest = await this.reviewRepository.findOne({
        where: { id: row.id },
      });
      if (latest?.status === CampaignReviewStatus.SUBMITTED) {
        throw new BadRequestException('Feedback was already submitted.');
      }
      throw new BadRequestException('This feedback link has expired.');
    }

    return { ok: true };
  }

  async getCampaignReviewSummary(
    campaignId: number,
    filters?: {
      from?: string;
      to?: string;
      q?: string;
      rating?: number;
    },
  ): Promise<CampaignReviewSummary> {
    const requestsSent = await this.reviewRepository.count({
      where: { campaignId },
    });

    const qb = this.reviewRepository
      .createQueryBuilder('review')
      .select('COUNT(*)', 'total')
      .addSelect('AVG(review.rating)', 'average')
      .where('review.campaign_id = :campaignId', { campaignId })
      .andWhere('review.status = :status', {
        status: CampaignReviewStatus.SUBMITTED,
      })
      .andWhere('review.rating IS NOT NULL');

    this.applyReviewListFilters(qb, filters);

    const submitted = await qb.getRawOne<{
      total: string;
      average: string | null;
    }>();

    const totalReviews = Number(submitted?.total ?? 0) || 0;
    const averageRaw =
      submitted?.average != null ? Number(submitted.average) : null;
    const averageRating =
      totalReviews > 0 && averageRaw != null && Number.isFinite(averageRaw)
        ? Math.round(averageRaw * 10) / 10
        : null;

    return { totalReviews, averageRating, requestsSent };
  }

  async listCampaignReviews(
    campaignId: number,
    page = 1,
    limit = 10,
    filters?: {
      from?: string;
      to?: string;
      q?: string;
      rating?: number;
    },
  ): Promise<{
    data: CampaignReviewListItem[];
    meta: ReturnType<typeof buildPaginationMeta>;
    summary: CampaignReviewSummary;
  }> {
    const pagination = normalizePagination(page, limit);
    const qb = this.reviewRepository
      .createQueryBuilder('review')
      .where('review.campaign_id = :campaignId', { campaignId })
      .andWhere('review.status = :status', {
        status: CampaignReviewStatus.SUBMITTED,
      });

    this.applyReviewListFilters(qb, filters);

    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('review.submitted_at', 'DESC')
      .addOrderBy('review.id', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit)
      .getMany();

    const summary = await this.getCampaignReviewSummary(campaignId, filters);

    return {
      data: rows.map((row) => ({
        id: row.id,
        rating: row.rating ?? 0,
        comment: row.comment,
        guestName: row.guestName,
        guestEmail: row.guestEmail,
        submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
      summary,
    };
  }

  private applyReviewListFilters(
    qb: SelectQueryBuilder<CampaignReview>,
    filters?: {
      from?: string;
      to?: string;
      q?: string;
      rating?: number;
    },
  ): void {
    const from = this.parseOptionalDate(filters?.from);
    const to = this.parseOptionalDate(filters?.to);
    if (from) {
      qb.andWhere('COALESCE(review.submitted_at, review.created_at) >= :from', {
        from,
      });
    }
    if (to) {
      qb.andWhere('COALESCE(review.submitted_at, review.created_at) <= :to', {
        to,
      });
    }

    const q = filters?.q?.trim();
    if (q) {
      qb.andWhere(
        `(
          COALESCE(review.guest_name, '') ILIKE :q
          OR COALESCE(review.guest_email, '') ILIKE :q
          OR COALESCE(review.comment, '') ILIKE :q
        )`,
        { q: `%${q}%` },
      );
    }

    const rating = Math.floor(Number(filters?.rating));
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      qb.andWhere('review.rating = :rating', { rating });
    }
  }

  async assertCampaignBelongsToBusiness(
    campaignId: number,
    businessId: number,
  ): Promise<void> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId, businessId },
      select: ['id'],
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
  }

  private async loadByToken(token: string): Promise<CampaignReview> {
    const safe = token.trim();
    if (!safe || safe.length < 16 || safe.length > 128) {
      throw new NotFoundException('Feedback link not found');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(safe)) {
      throw new NotFoundException('Feedback link not found');
    }
    const row = await this.reviewRepository.findOne({
      where: { tokenHash: this.hashToken(safe) },
    });
    if (!row) {
      throw new NotFoundException('Feedback link not found');
    }
    return row;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseOptionalDate(raw?: string): Date | null {
    if (!raw?.trim()) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toPublicGuestName(fullName: string | null): string | null {
    const first = fullName?.trim().split(/\s+/)[0] ?? '';
    if (!first) return null;
    return this.sanitizePlainText(first, 40);
  }

  private sanitizeEmail(raw: string | null | undefined): string | null {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 255);
    if (!value || !value.includes('@') || value.includes('<') || value.includes('>')) {
      return null;
    }
    return value;
  }

  private sanitizePlainText(
    raw: string | null | undefined,
    maxLength: number,
  ): string | null {
    if (raw == null) return null;
    const cleaned = String(raw)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    return cleaned.length > 0 ? cleaned : null;
  }
}
