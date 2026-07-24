import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignMedia } from '../../db/entities/meta-campaign-media.entity';
import { User } from '../../db/entities/user.entity';
import { BusinessAccessService } from '../business-access/business-access.service';
import { SpacesService } from '../spaces/spaces.service';
import { CAMPAIGNS_UPLOAD_SUBDIR } from '../../utils/disk-file-upload-multer';
import {
  PresignMediaDto,
  PresignMediaResponseDto,
} from './dto/presign-media.dto';

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

@Injectable()
export class MetaCampaignMediaService {
  constructor(
    @InjectRepository(MetaCampaignMedia)
    private readonly mediaRepository: Repository<MetaCampaignMedia>,
    @InjectRepository(MetaCampaignDraft)
    private readonly draftRepository: Repository<MetaCampaignDraft>,
    private readonly businessAccessService: BusinessAccessService,
    private readonly spacesService: SpacesService,
  ) {}

  async createPresignedUpload(
    user: User,
    businessId: number,
    dto: PresignMediaDto,
  ): Promise<PresignMediaResponseDto> {
    await this.assertMetaAccess(user, businessId);
    this.assertMimeMatchesType(dto.mediaType, dto.mimeType);

    if (dto.draftId?.trim()) {
      await this.assertDraftBelongs(user.id, businessId, dto.draftId.trim());
    }

    const { uploadUrl, publicUrl, objectKey } =
      await this.spacesService.createPresignedPutUrl({
        folder: CAMPAIGNS_UPLOAD_SUBDIR,
        filename: dto.filename,
        contentType: dto.mimeType,
      });

    const media = await this.mediaRepository.save({
      draftId: dto.draftId?.trim() || null,
      businessId,
      userId: user.id,
      mediaType: dto.mediaType,
      filename: dto.filename.trim(),
      mimeType: dto.mimeType.trim(),
      sizeBytes: String(dto.sizeBytes),
      storageKey: objectKey,
      storageUrl: publicUrl,
      uploadStatus: 'uploading',
      metaImageHash: null,
      metaVideoId: null,
      errorMessage: null,
    });

    return {
      mediaId: media.id,
      uploadUrl,
      publicUrl,
      objectKey,
      uploadStatus: media.uploadStatus,
    };
  }

  async completeUpload(
    user: User,
    businessId: number,
    mediaId: string,
  ): Promise<MetaCampaignMedia> {
    await this.assertMetaAccess(user, businessId);

    const media = await this.mediaRepository.findOne({
      where: {
        id: mediaId.trim(),
        businessId,
        userId: user.id,
      },
    });

    if (!media) {
      throw new NotFoundException('Media upload not found.');
    }

    if (!media.storageUrl?.startsWith('https://')) {
      throw new BadRequestException(
        'Media public URL is missing or not HTTPS.',
      );
    }

    media.uploadStatus = 'ready';
    media.errorMessage = null;
    return this.mediaRepository.save(media);
  }

  async recordServerUpload(params: {
    userId: number;
    businessId: number;
    draftId?: string | null;
    mediaType: 'image' | 'video';
    filename: string;
    mimeType: string;
    sizeBytes: number;
    storageUrl: string;
    storageKey?: string | null;
    metaImageHash?: string | null;
    metaVideoId?: string | null;
  }): Promise<MetaCampaignMedia> {
    return this.mediaRepository.save({
      draftId: params.draftId?.trim() || null,
      businessId: params.businessId,
      userId: params.userId,
      mediaType: params.mediaType,
      filename: params.filename.trim() || 'upload',
      mimeType: params.mimeType.trim() || 'application/octet-stream',
      sizeBytes: String(params.sizeBytes || 0),
      storageKey: params.storageKey ?? null,
      storageUrl: params.storageUrl,
      uploadStatus: 'ready',
      metaImageHash: params.metaImageHash ?? null,
      metaVideoId: params.metaVideoId ?? null,
      errorMessage: null,
    });
  }

  async findReadyMetaRefsByUrl(
    storageUrl: string,
  ): Promise<{ metaImageHash: string | null; metaVideoId: string | null } | null> {
    const url = storageUrl?.trim();
    if (!url) return null;

    const media = await this.mediaRepository.findOne({
      where: {
        storageUrl: url,
        uploadStatus: 'ready',
      },
      order: { updatedAt: 'DESC' },
    });

    if (!media) return null;
    if (!media.metaImageHash && !media.metaVideoId) return null;

    return {
      metaImageHash: media.metaImageHash,
      metaVideoId: media.metaVideoId,
    };
  }

  async markMetaRefs(
    storageUrl: string,
    refs: { imageHash?: string; videoId?: string },
  ): Promise<void> {
    const url = storageUrl?.trim();
    if (!url) return;

    const patch: Partial<MetaCampaignMedia> = {};
    if (refs.imageHash?.trim()) {
      patch.metaImageHash = refs.imageHash.trim();
    }
    if (refs.videoId?.trim()) {
      patch.metaVideoId = refs.videoId.trim();
    }
    if (!Object.keys(patch).length) return;

    await this.mediaRepository.update({ storageUrl: url }, patch);
  }

  private assertMimeMatchesType(
    mediaType: 'image' | 'video',
    mimeType: string,
  ): void {
    const mime = mimeType.trim().toLowerCase();
    if (mediaType === 'image' && !IMAGE_MIMES.has(mime)) {
      throw new BadRequestException(
        'Only image files are allowed (PNG, JPEG, WebP, GIF).',
      );
    }
    if (mediaType === 'video' && !VIDEO_MIMES.has(mime)) {
      throw new BadRequestException(
        'Only video files are allowed (MP4, MOV, WebM).',
      );
    }
  }

  private async assertDraftBelongs(
    userId: number,
    businessId: number,
    draftId: string,
  ): Promise<void> {
    const draft = await this.draftRepository.findOne({
      where: { id: draftId, businessId, userId },
      select: { id: true },
    });
    if (!draft) {
      throw new NotFoundException('Campaign draft not found.');
    }
  }

  private async assertMetaAccess(user: User, businessId: number): Promise<void> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['meta_ads', 'meta_campaigns'],
      'You do not have permission to access Meta campaigns for this business.',
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
  }
}
