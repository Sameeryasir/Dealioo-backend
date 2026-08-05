import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import { MetaProductEvent } from '../../db/entities/meta-product-event.entity';
import { MetaProductEventStatus } from '../../db/entities/meta-product-event-status';
import { UserFacebookAttribution } from '../../db/entities/user-facebook-attribution.entity';
import { ClaimFacebookAttributionDto } from './dto/claim-facebook-attribution.dto';
import { TrackProductMetaEventDto } from './dto/track-product-meta-event.dto';
import {
  hashEmailForMeta,
  hashExternalIdForMeta,
  hashPhoneForMeta,
} from './product-meta-hash.util';
import { ProductMetaCapiService } from './product-meta-capi.service';
import {
  PRODUCT_META_CAPI_QUEUE,
  ProductMetaCapiJobName,
  productMetaCapiJobId,
  type ProductMetaCapiJobPayload,
} from './product-meta-tracking-queue.constants';

export type FacebookAttributionView = {
  hasAttribution: boolean;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  capturedAt: string | null;
  source: string | null;
  landingUrl: string | null;
};

@Injectable()
export class ProductMetaTrackingService {
  private readonly logger = new Logger(ProductMetaTrackingService.name);

  constructor(
    @InjectRepository(MetaProductEvent)
    private readonly eventsRepo: Repository<MetaProductEvent>,
    @InjectRepository(UserFacebookAttribution)
    private readonly attributionRepo: Repository<UserFacebookAttribution>,
    @InjectQueue(PRODUCT_META_CAPI_QUEUE)
    private readonly capiQueue: Queue<ProductMetaCapiJobPayload>,
    private readonly capiService: ProductMetaCapiService,
  ) {}

  async ingest(
    dto: TrackProductMetaEventDto,
    requestMeta: { ip?: string; userAgent?: string },
  ): Promise<{ accepted: boolean; duplicate: boolean; eventId: string }> {
    const pixelId = this.capiService.getPixelId();
    if (!pixelId) {
      this.logger.warn(
        'Product Meta ingest skipped: RP_META_PIXEL_ID is not configured',
      );
      return { accepted: false, duplicate: false, eventId: dto.eventId };
    }

    const eventTime = String(
      dto.eventTime && dto.eventTime > 0
        ? dto.eventTime
        : Math.floor(Date.now() / 1000),
    );

    const userData: Record<string, unknown> = {};
    const em = hashEmailForMeta(dto.email);
    const ph = hashPhoneForMeta(dto.phone);
    const externalId = hashExternalIdForMeta(dto.externalId);
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];
    if (externalId) userData.external_id = [externalId];

    const row = this.eventsRepo.create({
      eventId: dto.eventId.trim(),
      eventName: dto.eventName.trim(),
      pixelId,
      product: 'dealioo',
      status: MetaProductEventStatus.PENDING,
      eventTime,
      eventSourceUrl: dto.eventSourceUrl?.trim() || null,
      actionSource: dto.actionSource?.trim() || 'website',
      fbp: dto.fbp?.trim() || null,
      fbc: dto.fbc?.trim() || null,
      fbclid: dto.fbclid?.trim() || null,
      userData: Object.keys(userData).length ? userData : null,
      customData: dto.customData ?? null,
      clientIp: dto.clientIp?.trim() || requestMeta.ip || null,
      userAgent: dto.userAgent?.trim() || requestMeta.userAgent || null,
      retryCount: 0,
    });

    let saved: MetaProductEvent;
    try {
      saved = await this.eventsRepo.save(row);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.log(
          `Duplicate product meta event_id=${dto.eventId} — idempotent accept`,
        );
        return { accepted: true, duplicate: true, eventId: dto.eventId };
      }
      throw err;
    }

    await this.enqueue(saved);
    this.logger.log(
      `Product meta event queued event_id=${saved.eventId} name=${saved.eventName}`,
    );
    return { accepted: true, duplicate: false, eventId: saved.eventId };
  }

  async claimAttribution(
    userId: number,
    dto: ClaimFacebookAttributionDto,
  ): Promise<{
    claimed: boolean;
    alreadyHad: boolean;
    attribution: FacebookAttributionView;
  }> {
    const existing = await this.attributionRepo.findOne({ where: { userId } });
    if (existing) {
      return {
        claimed: false,
        alreadyHad: true,
        attribution: this.toView(existing),
      };
    }

    const fbclid = dto.fbclid?.trim() || null;
    const fbc = dto.fbc?.trim() || null;
    const fbp = dto.fbp?.trim() || null;

    if (!fbclid) {
      return {
        claimed: false,
        alreadyHad: false,
        attribution: this.emptyView(),
      };
    }

    const row = this.attributionRepo.create({
      userId,
      fbclid,
      fbc,
      fbp,
      capturedAt: new Date(),
      source: dto.source?.trim() || 'anonymous_browser_claim',
      landingUrl: dto.landingUrl?.trim() || null,
    });

    try {
      const saved = await this.attributionRepo.save(row);
      this.logger.log(`Facebook attribution claimed for user_id=${userId}`);
      return {
        claimed: true,
        alreadyHad: false,
        attribution: this.toView(saved),
      };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const winner = await this.attributionRepo.findOne({ where: { userId } });
        return {
          claimed: false,
          alreadyHad: true,
          attribution: winner ? this.toView(winner) : this.emptyView(),
        };
      }
      throw err;
    }
  }

  async getAttribution(userId: number): Promise<FacebookAttributionView> {
    const row = await this.attributionRepo.findOne({ where: { userId } });
    return row ? this.toView(row) : this.emptyView();
  }

  async enqueue(row: MetaProductEvent): Promise<void> {
    if (!this.capiService.isConfigured()) {
      await this.eventsRepo.update(row.id, {
        status: MetaProductEventStatus.FAILED,
        lastError:
          'RP_META_CAPI_ACCESS_TOKEN (or pixel) not configured — event stored, not sent',
      });
      this.logger.warn(
        `Product CAPI not configured; event_id=${row.eventId} marked failed`,
      );
      return;
    }

    await this.capiQueue.add(
      ProductMetaCapiJobName.SEND_EVENT,
      { eventRowId: row.id, eventId: row.eventId },
      {
        jobId: productMetaCapiJobId(row.eventId),
        attempts: 8,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    );

    await this.eventsRepo.update(row.id, {
      status: MetaProductEventStatus.QUEUED,
    });
  }

  async processSend(eventRowId: string, attempt: number): Promise<void> {
    const row = await this.eventsRepo.findOne({ where: { id: eventRowId } });
    if (!row) {
      this.logger.warn(`CAPI job missing row id=${eventRowId}`);
      return;
    }

    if (row.status === MetaProductEventStatus.SENT) {
      return;
    }

    const payload = this.capiService.buildCapiPayload(row);

    try {
      const metaResponse = await this.capiService.sendEvent(row);
      await this.eventsRepo.update(row.id, {
        status: MetaProductEventStatus.SENT,
        payload: payload as object,
        metaResponse: metaResponse as object,
        retryCount: attempt,
        lastError: null,
        sentAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const metaResponse =
        err && typeof err === 'object' && 'metaResponse' in err
          ? ((err as { metaResponse?: object }).metaResponse ?? null)
          : null;

      await this.eventsRepo.update(row.id, {
        status: MetaProductEventStatus.FAILED,
        payload: payload as object,
        metaResponse: metaResponse as object | null,
        retryCount: attempt,
        lastError: message,
      });

      if (!this.capiService.isRetryableError(err)) {
        await this.eventsRepo.update(row.id, {
          status: MetaProductEventStatus.DEAD_LETTER,
        });
        throw err;
      }

      throw err;
    }
  }

  async markDeadLetter(eventRowId: string, errorMessage: string): Promise<void> {
    await this.eventsRepo.update(eventRowId, {
      status: MetaProductEventStatus.DEAD_LETTER,
      lastError: errorMessage,
    });
  }

  private toView(row: UserFacebookAttribution): FacebookAttributionView {
    return {
      hasAttribution: Boolean(row.fbclid || row.fbc || row.fbp),
      fbclid: row.fbclid,
      fbc: row.fbc,
      fbp: row.fbp,
      capturedAt: row.capturedAt?.toISOString?.() ?? null,
      source: row.source,
      landingUrl: row.landingUrl,
    };
  }

  private emptyView(): FacebookAttributionView {
    return {
      hasAttribution: false,
      fbclid: null,
      fbc: null,
      fbp: null,
      capturedAt: null,
      source: null,
      landingUrl: null,
    };
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driver = err.driverError as { code?: string } | undefined;
    return driver?.code === '23505';
  }
}
