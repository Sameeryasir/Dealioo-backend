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

    const versionNumber = funnel?.contentRevision ?? 1;

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
}
