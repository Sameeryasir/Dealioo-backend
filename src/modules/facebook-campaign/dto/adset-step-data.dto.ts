export type AdSetPromotedObjectDto = {
  pixelId?: string;
  customEventType?: string;
  pageId?: string;
};

export type AdSetAudienceDto = {
  country: string;
  region?: string;
  city?: string;
  radius?: number;
  distanceUnit?: string;
  latitude?: number;
  longitude?: number;
  locations?: Array<Record<string, unknown>>;
  ageMin: number;
  ageMax: number;
  gender: string;
  languages?: string[];
  interests?: string[];
  behaviors?: string[];
  demographics?: string[];
  customAudiences?: string[];
  excludedCustomAudiences?: string[];
};

export type AdSetPlacementsDto = {
  advantagePlusPlacements: boolean;
  devicePlatforms: { mobile: boolean; desktop: boolean };
  publisherPlatforms: {
    facebook: boolean;
    instagram: boolean;
    audienceNetwork?: boolean;
    messenger?: boolean;
  };
  facebookPositions: {
    feed: boolean;
    story: boolean;
    reels: boolean;
    marketplace: boolean;
    videoFeeds: boolean;
    rightHandColumn?: boolean;
  };
  instagramPositions: {
    stream: boolean;
    story: boolean;
    reels: boolean;
    explore: boolean;
  };
};

export type AdSetStepDataDto = {
  name: string;
  draftId: string;
  status: string;
  budgetType?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  dailyBudgetMinor?: string;
  lifetimeBudgetMinor?: string;
  bidStrategy: string;
  bidAmount?: number;
  billingEvent: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  startDateTime: string;
  endDateTime: string;
  optimizationGoal: string;
  destinationType: string;
  promotedObject?: AdSetPromotedObjectDto;
  audience: AdSetAudienceDto;
  placements: AdSetPlacementsDto;
};
