export type GoogleCampaignGoalId =
  | 'SALES'
  | 'LEADS'
  | 'WEBSITE_TRAFFIC'
  | 'AWARENESS'
  | 'APP_PROMOTION';

export type GoogleSalesChannelId =
  | 'WEBSITE'
  | 'ONLINE_STORE'
  | 'PHYSICAL_STORE'
  | 'PHONE_ORDERS'
  | 'MULTIPLE';

export type GoogleLeadContactMethodId =
  | 'CONTACT_FORM'
  | 'PHONE_CALLS'
  | 'WHATSAPP'
  | 'APPOINTMENT_BOOKING';

export type GoogleTrafficActionId =
  | 'LEARN_MORE'
  | 'SHOP'
  | 'READ_MORE'
  | 'DOWNLOAD'
  | 'CONTACT_US';

export type GoogleAgeRangeId =
  | '18-24'
  | '25-34'
  | '35-44'
  | '45-54'
  | '55+';

export type GoogleKeywordMatchType = 'BROAD' | 'PHRASE' | 'EXACT';

export type GoogleBidStrategyId =
  | 'MAXIMIZE_CLICKS'
  | 'MAXIMIZE_CONVERSIONS'
  | 'MANUAL_CPC'
  | 'TARGET_CPA'
  | 'TARGET_ROAS';

export type GoogleCampaignTypeId = 'SEARCH' | 'DISPLAY' | 'PERFORMANCE_MAX';

export type GoogleCallToActionId =
  | 'LEARN_MORE'
  | 'BOOK_NOW'
  | 'CALL_NOW'
  | 'SHOP_NOW'
  | 'ORDER_ONLINE'
  | 'GET_QUOTE'
  | 'SIGN_UP'
  | 'CONTACT_US';

export type GoogleGenderId = 'ALL' | 'MALE' | 'FEMALE';

export type GoogleRadiusUnitId = 'KILOMETERS' | 'MILES';

export type GooglePresenceOptionId =
  | 'PRESENCE'
  | 'SEARCH'
  | 'PRESENCE_OR_INTEREST'
  | 'PRESENCE_NOT_EXCLUDED';

export type GoogleAdsLocationType =
  | 'country'
  | 'state'
  | 'city'
  | 'postal_code';

export type GoogleAdsLocationRefData = {
  type: GoogleAdsLocationType;
  id: string;
  name: string;
  latitude?: number;
  longitude?: number;
};

export type GoogleSuggestedKeywordData = {
  id: string;
  text: string;
  enabled: boolean;
};

export type GoogleAdCreativeDraftData = {
  id: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
  path1: string;
  path2: string;
  callToAction: GoogleCallToActionId;
};

export type GoogleSitelinkDraftData = {
  id: string;
  text: string;
  url: string;
  description1: string;
  description2: string;
  enabled: boolean;
};

export type GoogleCampaignBuilderDraftData = {
  goal: GoogleCampaignGoalId | null;
  goalDetailSubstep: number;
  salesChannel: GoogleSalesChannelId | null;
  businessLocation: string;
  leadContactMethods: GoogleLeadContactMethodId[];
  landingPageUrl: string;
  businessPhone: string;
  trafficAction: GoogleTrafficActionId | null;
  businessAddress: string;
  businessHours: string;
  appName: string;
  campaignName: string;
  businessName: string;
  websiteUrl: string;
  businessCategory: string;
  logoPreviewUrl: string;
  logoFileName: string;
  dailyBudget: number;
  startDate: string;
  endDate: string;
  countries: string[];
  regions: string[];
  cities: string[];
  targetLocations: GoogleAdsLocationRefData[];
  excludedLocationTargets: GoogleAdsLocationRefData[];
  radiusTargeting: string;
  radiusEnabled: boolean;
  radiusCenter: GoogleAdsLocationRefData | null;
  radiusLat: number | null;
  radiusLng: number | null;
  radiusValue: number;
  radiusUnit: GoogleRadiusUnitId;
  excludedLocations: string[];
  presenceOption: GooglePresenceOptionId;
  languages: string[];
  ageRanges: GoogleAgeRangeId[];
  gender: GoogleGenderId;
  householdIncome: string;
  interests: string[];
  businessType: string;
  suggestedKeywords: GoogleSuggestedKeywordData[];
  customKeywords: string[];
  negativeKeywords: string[];
  keywordMatchType: GoogleKeywordMatchType;
  ads: GoogleAdCreativeDraftData[];
  adsGenerated: boolean;
  extensionBusinessName: string;
  phoneNumber: string;
  callouts: string[];
  structuredSnippetHeader: string;
  structuredSnippetValues: string[];
  useLocationExtension: boolean;
  sitelinks: GoogleSitelinkDraftData[];
  assetsGenerated: boolean;
  campaignType: GoogleCampaignTypeId;
  bidStrategy: GoogleBidStrategyId;
  targetCpa: string;
  targetRoas: string;
  adSchedule: string;
  deviceTargeting: string[];
  networkSelection: string[];
  ipExclusions: string;
  urlTrackingParams: string;
  conversionGoals: string;
  brandExclusions: string;
  frequencyCapping: string;
  contentExclusions: string;
  audienceExpansion: boolean;
  savedAt: string | null;
  currentStep: number;
};
