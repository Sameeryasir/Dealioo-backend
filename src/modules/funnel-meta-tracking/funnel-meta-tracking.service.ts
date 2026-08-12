import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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

@Injectable()
export class FunnelMetaTrackingService {
  private readonly logger = new Logger(FunnelMetaTrackingService.name);

  constructor(
    @InjectRepository(MetaFunnelEvent)
    private readonly eventsRepo: Repository<MetaFunnelEvent>,
    private readonly businessTrackingService: BusinessTrackingService,
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
      status: MetaFunnelEventStatus.STORED,
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
    });

    try {
      const saved = await this.eventsRepo.save(row);
      this.logger.log(
        `Meta event sent event_id=${saved.eventId} name=${saved.eventName} businessId=${businessId}`,
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
