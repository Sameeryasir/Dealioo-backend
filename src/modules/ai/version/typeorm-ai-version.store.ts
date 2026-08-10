import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignType } from '../../../db/entities/campaign.entity';
import { Funnel } from '../../../db/entities/funnel.entity';
import { FunnelVersion } from '../../../db/entities/funnel-version.entity';
import {
  FunnelPageType,
  isFunnelPageType,
} from '../../../db/entities/funnel-page-type';
import { FunnelPagesService } from '../../funnel-pages/funnel-pages.service';
import type { AiSchemaVersion } from './ai-schema-version';
import type { AiVersionStore } from './ai-version-store.interface';

@Injectable()
export class TypeOrmAiVersionStore implements AiVersionStore {
  constructor(
    @InjectRepository(FunnelVersion)
    private readonly funnelVersionRepository: Repository<FunnelVersion>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    private readonly funnelPagesService: FunnelPagesService,
  ) {}

  async save(version: AiSchemaVersion): Promise<void> {
    if (version.funnelId == null) {
      return;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: version.funnelId },
      relations: ['campaign'],
    });
    const isPostpaid = funnel?.campaign?.campaignType === CampaignType.POSTPAID;

    const changedPages = version.changedPages ?? version.schema;
    const pagesForSave = isPostpaid
      ? (() => {
          const { payment: _payment, ...rest } = changedPages as Record<
            string,
            unknown
          >;
          return rest;
        })()
      : changedPages;
    const onlyTypes = Object.keys(pagesForSave).filter(isFunnelPageType);

    const { assembledPages, changedTypes } =
      await this.funnelPagesService.syncPages({
        funnelId: version.funnelId,
        businessId: version.businessId,
        pages: pagesForSave,
        onlyTypes: onlyTypes.length > 0 ? onlyTypes : undefined,
        operationId: version.operationId,
        createdById: null,
        bumpRevision: true,
        removePageTypes: isPostpaid
          ? ([FunnelPageType.PAYMENT] as const)
          : undefined,
      });

    if (changedTypes.length === 0) {
      return;
    }

    const versionNumber = await this.nextFunnelVersionNumber(version.funnelId);

    await this.funnelVersionRepository.save(
      this.funnelVersionRepository.create({
        id: version.versionId,
        funnelId: version.funnelId,
        businessId: version.businessId,
        versionNumber,
        schema: structuredClone(assembledPages),
        operationId: version.operationId,
        createdById: null,
      }),
    );
  }

  private async nextFunnelVersionNumber(funnelId: number): Promise<number> {
    const latest = await this.funnelRepository.findOne({
      where: { id: funnelId },
      select: ['id', 'contentRevision'],
    });
    const maxExisting = await this.getMaxVersionNumber(funnelId);
    const versionNumber = Math.max(
      latest?.contentRevision ?? 0,
      maxExisting + 1,
    );

    if (latest != null && versionNumber > (latest.contentRevision ?? 0)) {
      await this.funnelRepository.update(funnelId, {
        contentRevision: versionNumber,
      });
    }

    return versionNumber;
  }

  private async getMaxVersionNumber(funnelId: number): Promise<number> {
    const result = await this.funnelVersionRepository
      .createQueryBuilder('version')
      .select('MAX(version.versionNumber)', 'max')
      .where('version.funnelId = :funnelId', { funnelId })
      .getRawOne<{ max: string | null }>();

    const max = result?.max != null ? Number(result.max) : 0;
    return Number.isFinite(max) ? max : 0;
  }
}
