import { BadRequestException } from '@nestjs/common';
import { SaveAdCreativeStepDto } from './dto/save-ad-creative-step.dto';
import { MetaCreativeFormat } from './meta-campaign.constants';
import {
  assertDirectMetaImageUrl,
  assertDirectMetaVideoUrl,
} from './facebook-campaign-meta';
import { normalizeCampaignImageUrlForMeta } from '../../utils/disk-file-upload-multer';
import { normalizeMetaHttpsUrl } from '../../utils/normalize-meta-https-url';

export function assertAdCreativeMedia(dto: SaveAdCreativeStepDto): void {
  switch (dto.creativeFormat) {
    case MetaCreativeFormat.SINGLE_IMAGE:
      if (!dto.imageUrl?.trim()) {
        throw new BadRequestException('Image is required for single image ads.');
      }
      const imageForMeta =
        normalizeCampaignImageUrlForMeta(dto.imageUrl) ?? dto.imageUrl.trim();
      assertDirectMetaImageUrl(imageForMeta);
      break;
    case MetaCreativeFormat.SINGLE_VIDEO:
      if (!dto.videoUrl?.trim()) {
        throw new BadRequestException('Video is required for single video ads.');
      }
      assertDirectMetaVideoUrl(String(normalizeMetaHttpsUrl(dto.videoUrl)));
      break;
    case MetaCreativeFormat.CAROUSEL:
      if (!dto.carouselCards?.length || dto.carouselCards.length < 2) {
        throw new BadRequestException(
          'Carousel ads require at least 2 cards.',
        );
      }
      for (const [index, card] of dto.carouselCards.entries()) {
        const hasImage = Boolean(card.imageUrl?.trim());
        const hasVideo = Boolean(card.videoUrl?.trim());
        if (hasImage === hasVideo) {
          throw new BadRequestException(
            `Carousel card ${index + 1} needs an image or video.`,
          );
        }
        if (card.imageUrl?.trim()) {
          const cardImage =
            normalizeCampaignImageUrlForMeta(card.imageUrl) ??
            card.imageUrl.trim();
          assertDirectMetaImageUrl(cardImage);
        }
        if (card.videoUrl?.trim()) {
          assertDirectMetaVideoUrl(String(normalizeMetaHttpsUrl(card.videoUrl)));
        }
        const dest = String(normalizeMetaHttpsUrl(card.destinationUrl));
        if (!dest.startsWith('https://')) {
          throw new BadRequestException(
            `Carousel card ${index + 1}: destination URL must use HTTPS.`,
          );
        }
      }
      break;
    default:
      throw new BadRequestException('Creative format is required.');
  }
}

export function assertAdCreativeDestinationUrl(dto: SaveAdCreativeStepDto): void {
  if (dto.creativeFormat === MetaCreativeFormat.CAROUSEL) {
    return;
  }

  const destination = String(normalizeMetaHttpsUrl(dto.destinationUrl ?? ''));
  if (!destination.startsWith('https://')) {
    throw new BadRequestException(
      'Landing page URL must use HTTPS. Set NEXT_PUBLIC_FRONTEND_URL or FRONTEND_URL to your public ngrok URL.',
    );
  }
}

export function buildDestinationUrlWithParams(
  baseUrl: string,
  urlParameters?: string,
): string {
  const trimmed = baseUrl.trim();
  if (!urlParameters?.trim()) {
    return trimmed;
  }

  const params = urlParameters.trim().replace(/^[?&]/, '');
  const separator = trimmed.includes('?') ? '&' : '?';
  return `${trimmed}${separator}${params}`;
}
