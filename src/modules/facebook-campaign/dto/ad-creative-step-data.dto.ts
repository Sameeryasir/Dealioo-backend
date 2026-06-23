export type CarouselCardDto = {
  mediaType?: 'image' | 'video';
  imageUrl?: string;
  videoUrl?: string;
  headline: string;
  description?: string;
  destinationUrl: string;
  callToAction: string;
};

export type AdCreativeStepDataDto = {
  name: string;
  draftId: string;
  facebookPageId: string;
  instagramActorId?: string;
  status: string;
  creativeFormat: string;
  imageUrl?: string;
  imageAltText?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  carouselCards?: CarouselCardDto[];
  primaryText: string;
  headline?: string;
  description?: string;
  displayLink?: string;
  destinationUrl?: string;
  urlParameters?: string;
  callToAction?: string;
  pixelId?: string;
  conversionEvent?: string;
  brandingEnabled?: boolean;
  brandName?: string;
  brandLogoUrl?: string;
};
