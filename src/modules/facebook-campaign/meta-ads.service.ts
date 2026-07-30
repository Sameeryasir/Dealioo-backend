import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  normalizeCampaignImageUrlForMeta,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import {
  assertDirectMetaImageUrl,
  assertDirectMetaVideoUrl,
} from './facebook-campaign-meta';
import {
  sdkUploadAdImageHash,
  sdkUploadAdVideoId,
} from './meta-business-sdk';
import { MediaService } from './media.service';

export type MetaAdsImageResult = {
  storageUrl: string;
  imageHash: string;
  reused: boolean;
};

export type MetaAdsVideoResult = {
  storageUrl: string;
  videoId: string;
  reused: boolean;
};

@Injectable()
export class MetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name);

  constructor(private readonly mediaService: MediaService) {}

  async uploadImageToMeta(params: {
    adAccountId: string;
    accessToken: string;
    storageUrl: string;
  }): Promise<MetaAdsImageResult> {
    const storageUrl =
      normalizeCampaignImageUrlForMeta(params.storageUrl) ??
      params.storageUrl.trim();

    this.assertPublicHttpsUrl(storageUrl, 'image');
    assertDirectMetaImageUrl(storageUrl);

    const existing = await this.mediaService.findMetaRefsByStorageUrl(storageUrl);
    if (existing?.metaImageHash?.trim()) {
      return {
        storageUrl,
        imageHash: existing.metaImageHash.trim(),
        reused: true,
      };
    }

    try {
      const imageHash = await sdkUploadAdImageHash(
        params.accessToken,
        params.adAccountId,
        storageUrl,
      );
      await this.mediaService.markMetaUploadSuccess(storageUrl, {
        imageHash,
      });
      return { storageUrl, imageHash, reused: false };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Meta image upload failed.';
      await this.mediaService.markMetaUploadFailed(storageUrl, message);
      throw err;
    }
  }

  async uploadVideoToMeta(params: {
    adAccountId: string;
    accessToken: string;
    storageUrl: string;
  }): Promise<MetaAdsVideoResult> {
    const storageUrl =
      toAbsoluteAssetUrlIfRelative(params.storageUrl.trim()) ??
      params.storageUrl.trim();

    this.assertPublicHttpsUrl(storageUrl, 'video');
    assertDirectMetaVideoUrl(storageUrl);

    const existing = await this.mediaService.findMetaRefsByStorageUrl(storageUrl);
    if (existing?.metaVideoId?.trim()) {
      return {
        storageUrl,
        videoId: existing.metaVideoId.trim(),
        reused: true,
      };
    }

    try {
      const videoId = await sdkUploadAdVideoId(
        params.accessToken,
        params.adAccountId,
        storageUrl,
      );
      await this.mediaService.markMetaUploadSuccess(storageUrl, {
        videoId,
      });
      return { storageUrl, videoId, reused: false };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Meta video upload failed.';
      await this.mediaService.markMetaUploadFailed(storageUrl, message);
      this.logger.warn(
        `Meta video upload failed for ${storageUrl}: ${message}`,
      );
      throw err;
    }
  }

  assertMediaExists(storageUrl: string | null | undefined, kind: 'image' | 'video'): string {
    const url = storageUrl?.trim();
    if (!url) {
      throw new BadRequestException(
        kind === 'image'
          ? 'Ad image is missing. Upload an image before publishing.'
          : 'Ad video is missing. Upload a video before publishing.',
      );
    }
    this.assertPublicHttpsUrl(url, kind);
    return url;
  }

  private assertPublicHttpsUrl(url: string, kind: 'image' | 'video'): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(
        `Invalid ${kind} storage URL. Re-upload the file and try again.`,
      );
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException(
        `${kind === 'image' ? 'Image' : 'Video'} URL must be public HTTPS so Meta can download it.`,
      );
    }
  }
}
