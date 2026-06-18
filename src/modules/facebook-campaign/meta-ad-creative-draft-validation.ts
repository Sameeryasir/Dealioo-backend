import { BadRequestException } from '@nestjs/common';
import { AdSetPlacementsDto } from './dto/save-adset-step.dto';
import { SaveAdCreativeStepDto } from './dto/save-ad-creative-step.dto';
import { MetaCreativeFormat } from './meta-campaign.constants';

export function hasInstagramPlacements(placements: AdSetPlacementsDto): boolean {
  if (placements.advantagePlusPlacements) {
    return true;
  }

  if (placements.publisherPlatforms.instagram) {
    return true;
  }

  return Object.values(placements.instagramPositions).some(Boolean);
}

export function assertAdCreativeMedia(dto: SaveAdCreativeStepDto): void {
  switch (dto.creativeFormat) {
    case MetaCreativeFormat.SINGLE_IMAGE:
      if (!dto.imageUrl?.trim()) {
        throw new BadRequestException('Image is required for single image ads.');
      }
      break;
    case MetaCreativeFormat.SINGLE_VIDEO:
      if (!dto.videoUrl?.trim()) {
        throw new BadRequestException('Video is required for single video ads.');
      }
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
      }
      break;
    default:
      throw new BadRequestException('Creative format is required.');
  }
}

export function assertInstagramActorIfNeeded(
  placements: AdSetPlacementsDto,
  instagramActorId?: string,
): void {
  if (!hasInstagramPlacements(placements)) {
    return;
  }

  if (!instagramActorId?.trim()) {
    throw new BadRequestException(
      'Instagram placements are enabled on your ad set. Select an Instagram account or remove Instagram placements on Step 2.',
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
