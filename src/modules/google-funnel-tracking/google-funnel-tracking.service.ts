import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { GoogleFunnelEvent } from '../../db/entities/google-funnel-event.entity';
import { GoogleFunnelEventStatus } from '../../db/entities/google-funnel-event-status';
import { BusinessTrackingService } from '../business-tracking/business-tracking.service';
import { TrackGoogleFunnelEventDto } from './dto/track-google-funnel-event.dto';

@Injectable()
export class GoogleFunnelTrackingService {
  private readonly logger = new Logger(GoogleFunnelTrackingService.name);

  constructor(
    @InjectRepository(GoogleFunnelEvent)
    private readonly eventsRepo: Repository<GoogleFunnelEvent>,
    private readonly businessTrackingService: BusinessTrackingService,
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
      status: GoogleFunnelEventStatus.STORED,
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
    });

    try {
      const saved = await this.eventsRepo.save(row);
      this.logger.log(
        `Google event stored event_id=${saved.eventId} name=${saved.eventName} businessId=${businessId}`,
      );
      return { accepted: true, duplicate: false, eventId: saved.eventId };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        return { accepted: true, duplicate: true, eventId };
      }
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const code = (err as unknown as { code?: string }).code;
    return typeof code === 'string' && code === '23505';
  }
}
