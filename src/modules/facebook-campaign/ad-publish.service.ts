import { Injectable } from '@nestjs/common';
import { User } from '../../db/entities/user.entity';
import { EnqueueMetaPublishResponseDto } from './dto/enqueue-meta-publish-response.dto';
import { MetaPublishStatusDto } from './dto/meta-publish-status.dto';
import { MetaPublishService } from './meta-publish.service';

@Injectable()
export class AdPublishService {
  constructor(private readonly metaPublishService: MetaPublishService) {}

  enqueuePublish(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<EnqueueMetaPublishResponseDto> {
    return this.metaPublishService.enqueuePublish(user, businessId, draftId);
  }

  getPublishStatus(
    user: User,
    businessId: number,
    draftId: string,
  ): Promise<MetaPublishStatusDto> {
    return this.metaPublishService.getPublishStatus(user, businessId, draftId);
  }

  processQueuedPublish(job: Parameters<MetaPublishService['processQueuedPublish']>[0]) {
    return this.metaPublishService.processQueuedPublish(job);
  }

  publishFullCampaign(
    ...args: Parameters<MetaPublishService['publishFullCampaign']>
  ) {
    return this.metaPublishService.publishFullCampaign(...args);
  }
}
