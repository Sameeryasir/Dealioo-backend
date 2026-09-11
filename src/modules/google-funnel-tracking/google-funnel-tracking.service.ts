import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { QueryFailedError, Repository } from 'typeorm';
import { GoogleFunnelEvent } from '../../db/entities/google-funnel-event.entity';
import {
  GoogleFunnelEventName,
  GoogleFunnelEventStatus,
} from '../../db/entities/google-funnel-event-status';
import { BusinessTrackingService } from '../business-tracking/business-tracking.service';
import { TrackGoogleFunnelEventDto } from './dto/track-google-funnel-event.dto';
import { FunnelGoogleConversionUploadService } from './funnel-google-conversion-upload.service';
import {
  FUNNEL_GOOGLE_UPLOAD_QUEUE,
  FunnelGoogleUploadJobName,
  funnelGoogleUploadJobId,
  type FunnelGoogleUploadJobPayload,
} from './google-funnel-tracking-queue.constants';

@Injectable()
export class GoogleFunnelTrackingService {
  private readonly logger = new Logger(GoogleFunnelTrackingService.name);

  constructor(
    @InjectRepository(GoogleFunnelEvent)
    private readonly eventsRepo: Repository<GoogleFunnelEvent>,
    private readonly businessTrackingService: BusinessTrackingService,
    @InjectQueue(FUNNEL_GOOGLE_UPLOAD_QUEUE)
    private readonly uploadQueue: Queue<FunnelGoogleUploadJobPayload>,
    private readonly uploadService: FunnelGoogleConversionUploadService,
  ) {}

  async ingest(
    dto: TrackGoogleFunnelEventDto,
    requestMeta: { ip?: string; userAgent?: string },
  ): Promise<{ accepted: boolean; duplicate: boolean; eventId: string }> {
    const businessId = dto.businessId;
    const googleAdsId = dto.googleAdsId.trim();
    const eventId = dto.eventId.trim();

    const active =
      await this.businessTrackingService.getActivePublicIdsForBusiness(
        businessId,
      );
    if (
      !active.googleTagManagerId ||
      active.googleTagManagerId !== googleAdsId
    ) {
      this.logger.warn(
        `Google funnel ingest rejected: tag mismatch businessId=${businessId}`,
      );
      return { accepted: false, duplicate: false, eventId };
    }

    const eventTime = String(
      dto.eventTime && dto.eventTime > 0
        ? dto.eventTime
        : Math.floor(Date.now() / 1000),
    );

    const conversionLabel = dto.conversionLabel?.trim() || null;
    const sendTo =
      dto.sendTo?.trim() ||
      (conversionLabel ? `${googleAdsId}/${conversionLabel}` : null);

    const row = this.eventsRepo.create({
      eventId,
      eventName: dto.eventName.trim(),
      businessId,
      funnelId: dto.funnelId ?? null,
      googleAdsId,
      conversionLabel,
      sendTo,
      status: GoogleFunnelEventStatus.PENDING,
      eventTime,
      eventSourceUrl: dto.eventSourceUrl?.trim() || null,
      value:
        dto.value != null && Number.isFinite(dto.value)
          ? String(dto.value)
          : null,
      currency: dto.currency?.trim().toUpperCase() || null,
      transactionId: dto.transactionId?.trim() || null,
      gclid: dto.gclid?.trim() || null,
      customData: dto.customData ?? null,
      clientIp: dto.clientIp?.trim() || requestMeta.ip || null,
      userAgent: dto.userAgent?.trim() || requestMeta.userAgent || null,
      retryCount: 0,
    });

    let saved: GoogleFunnelEvent;
    try {
      saved = await this.eventsRepo.save(row);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        return { accepted: true, duplicate: true, eventId };
      }
      throw err;
    }

    await this.enqueue(saved);
    return { accepted: true, duplicate: false, eventId: saved.eventId };
  }

  async enqueue(row: GoogleFunnelEvent): Promise<void> {
    if (!this.shouldUpload(row)) {
      await this.eventsRepo.update(row.id, {
        status: GoogleFunnelEventStatus.STORED,
        lastError: null,
        googleResponse: {
          skipped: true,
          reason: 'analytics_only_or_missing_gclid_label',
        } as object,
      });
      return;
    }

    await this.uploadQueue.add(
      FunnelGoogleUploadJobName.SEND_EVENT,
      { eventRowId: row.id, eventId: row.eventId },
      {
        jobId: funnelGoogleUploadJobId(row.eventId),
        attempts: 8,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    );

    await this.eventsRepo.update(row.id, {
      status: GoogleFunnelEventStatus.QUEUED,
    });
  }

  async processSend(eventRowId: string, attempt: number): Promise<void> {
    const row = await this.eventsRepo.findOne({ where: { id: eventRowId } });
    if (!row) {
      this.logger.warn(`Google upload job missing row id=${eventRowId}`);
      return;
    }

    if (row.status === GoogleFunnelEventStatus.SENT) {
      return;
    }

    if (!this.shouldUpload(row)) {
      await this.eventsRepo.update(row.id, {
        status: GoogleFunnelEventStatus.STORED,
        retryCount: attempt,
        googleResponse: {
          skipped: true,
          reason: 'analytics_only_or_missing_gclid_label',
        } as object,
      });
      return;
    }

    const label = row.conversionLabel!.trim();
    let conversionAction = row.conversionAction?.trim() || null;
    if (!conversionAction) {
      conversionAction =
        await this.uploadService.resolveConversionActionResource(
          row.businessId,
          label,
        );
    }

    if (!conversionAction) {
      await this.eventsRepo.update(row.id, {
        status: GoogleFunnelEventStatus.DEAD_LETTER,
        retryCount: attempt,
        lastError: `Could not resolve Google conversion action for label=${label}. Create/enable the conversion in Google Ads and ensure the label matches.`,
      });
      return;
    }

    const payload = {
      gclid: row.gclid,
      conversion_action: conversionAction,
      conversion_label: label,
      event_name: row.eventName,
      event_time: row.eventTime,
      value: row.value,
      currency: row.currency,
      order_id: row.transactionId,
    };

    try {
      const googleResponse = await this.uploadService.uploadClickConversion(
        row,
        conversionAction,
      );
      await this.eventsRepo.update(row.id, {
        status: GoogleFunnelEventStatus.SENT,
        conversionAction,
        payload: payload as object,
        googleResponse: googleResponse as object,
        retryCount: attempt,
        lastError: null,
        sentAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const googleResponse =
        err && typeof err === 'object' && 'googleResponse' in err
          ? ((err as { googleResponse?: object }).googleResponse ?? null)
          : null;

      await this.eventsRepo.update(row.id, {
        status: GoogleFunnelEventStatus.FAILED,
        conversionAction,
        payload: payload as object,
        googleResponse: googleResponse as object | null,
        retryCount: attempt,
        lastError: message,
      });

      if (!this.uploadService.isRetryableError(err)) {
        await this.eventsRepo.update(row.id, {
          status: GoogleFunnelEventStatus.DEAD_LETTER,
        });
        throw err;
      }

      throw err;
    }
  }

  async markDeadLetter(eventRowId: string, errorMessage: string): Promise<void> {
    await this.eventsRepo.update(eventRowId, {
      status: GoogleFunnelEventStatus.DEAD_LETTER,
      lastError: errorMessage,
    });
  }

  private shouldUpload(row: GoogleFunnelEvent): boolean {
    const gclid = row.gclid?.trim();
    const label = row.conversionLabel?.trim();
    if (!gclid || !label) return false;
    return row.eventName?.trim() === GoogleFunnelEventName.CONVERSION;
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driver = err.driverError as { code?: string } | undefined;
    return driver?.code === '23505';
  }
}
