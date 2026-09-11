import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import { MetaFunnelEvent } from '../../db/entities/meta-funnel-event.entity';
import { MetaFunnelEventStatus } from '../../db/entities/meta-funnel-event-status';
import { BusinessTrackingService } from '../business-tracking/business-tracking.service';
import {
  hashEmailForMeta,
  hashExternalIdForMeta,
  hashPhoneForMeta,
} from '../product-meta-tracking/product-meta-hash.util';
import { TrackFunnelMetaEventDto } from './dto/track-funnel-meta-event.dto';
import { FunnelMetaCapiService } from './funnel-meta-capi.service';
import {
  FUNNEL_META_CAPI_QUEUE,
  FunnelMetaCapiJobName,
  funnelMetaCapiJobId,
  type FunnelMetaCapiJobPayload,
} from './funnel-meta-tracking-queue.constants';

@Injectable()
export class FunnelMetaTrackingService {
  private readonly logger = new Logger(FunnelMetaTrackingService.name);

  constructor(
    @InjectRepository(MetaFunnelEvent)
    private readonly eventsRepo: Repository<MetaFunnelEvent>,
    private readonly businessTrackingService: BusinessTrackingService,
    @InjectQueue(FUNNEL_META_CAPI_QUEUE)
    private readonly capiQueue: Queue<FunnelMetaCapiJobPayload>,
    private readonly capiService: FunnelMetaCapiService,
  ) {}

  async ingest(
    dto: TrackFunnelMetaEventDto,
    requestMeta: { ip?: string; userAgent?: string },
  ): Promise<{ accepted: boolean; duplicate: boolean; eventId: string }> {
    const businessId = dto.businessId;
    const pixelId = dto.pixelId.trim();
    const eventId = dto.eventId.trim();

    const active =
      await this.businessTrackingService.getActivePublicIdsForBusiness(
        businessId,
      );
    if (!active.pixelId || active.pixelId !== pixelId) {
      this.logger.warn(
        `Funnel Meta ingest rejected: pixel mismatch businessId=${businessId}`,
      );
      return { accepted: false, duplicate: false, eventId };
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
      eventId,
      eventName: dto.eventName.trim(),
      businessId,
      funnelId: dto.funnelId ?? null,
      pixelId,
      status: MetaFunnelEventStatus.PENDING,
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

    let saved: MetaFunnelEvent;
    try {
      saved = await this.eventsRepo.save(row);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.log(
          `Duplicate funnel meta event_id=${eventId} — idempotent accept`,
        );
        return { accepted: true, duplicate: true, eventId };
      }
      throw err;
    }

    await this.enqueue(saved);
    this.logger.log(
      `Funnel meta event queued event_id=${saved.eventId} name=${saved.eventName} businessId=${businessId}`,
    );
    return { accepted: true, duplicate: false, eventId: saved.eventId };
  }

  async enqueue(row: MetaFunnelEvent): Promise<void> {
    const credentials =
      await this.businessTrackingService.getCapiCredentials(row.businessId);

    if (!credentials || credentials.pixelId !== row.pixelId) {
      await this.eventsRepo.update(row.id, {
        status: MetaFunnelEventStatus.FAILED,
        lastError:
          'Funnel CAPI not configured — save Meta Pixel and connect Meta Ads (or paste a CAPI access token) in Ads Tracking',
      });
      this.logger.warn(
        `Funnel CAPI not configured; event_id=${row.eventId} businessId=${row.businessId} marked failed`,
      );
      return;
    }

    await this.capiQueue.add(
      FunnelMetaCapiJobName.SEND_EVENT,
      { eventRowId: row.id, eventId: row.eventId },
      {
        jobId: funnelMetaCapiJobId(row.eventId),
        attempts: 8,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    );

    await this.eventsRepo.update(row.id, {
      status: MetaFunnelEventStatus.QUEUED,
    });
  }

  async processSend(eventRowId: string, attempt: number): Promise<void> {
    const row = await this.eventsRepo.findOne({ where: { id: eventRowId } });
    if (!row) {
      this.logger.warn(`Funnel CAPI job missing row id=${eventRowId}`);
      return;
    }

    if (row.status === MetaFunnelEventStatus.SENT) {
      return;
    }

    const credentials =
      await this.businessTrackingService.getCapiCredentials(row.businessId);
    if (!credentials || credentials.pixelId !== row.pixelId) {
      await this.eventsRepo.update(row.id, {
        status: MetaFunnelEventStatus.DEAD_LETTER,
        lastError:
          'Funnel CAPI credentials missing at send time — connect Meta Ads or save a CAPI token',
        retryCount: attempt,
      });
      return;
    }

    const payload = this.capiService.buildCapiPayload(row);

    try {
      const metaResponse = await this.capiService.sendEvent(row, credentials);
      await this.eventsRepo.update(row.id, {
        status: MetaFunnelEventStatus.SENT,
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
        status: MetaFunnelEventStatus.FAILED,
        payload: payload as object,
        metaResponse: metaResponse as object | null,
        retryCount: attempt,
        lastError: message,
      });

      if (!this.capiService.isRetryableError(err)) {
        await this.eventsRepo.update(row.id, {
          status: MetaFunnelEventStatus.DEAD_LETTER,
        });
        throw err;
      }

      throw err;
    }
  }

  async markDeadLetter(eventRowId: string, errorMessage: string): Promise<void> {
    await this.eventsRepo.update(eventRowId, {
      status: MetaFunnelEventStatus.DEAD_LETTER,
      lastError: errorMessage,
    });
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driver = err.driverError as { code?: string } | undefined;
    return driver?.code === '23505';
  }
}
