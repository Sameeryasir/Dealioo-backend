import type {
  GoogleCampaignBuilderDraftData,
  GoogleCampaignGoalId,
} from '../../db/entities/google-campaign-builder-draft.types';

export function createDefaultGoogleCampaignDraftData(): GoogleCampaignBuilderDraftData {
  return {
    goal: null,
    goalDetailSubstep: 0,
    salesChannel: null,
    businessLocation: '',
    businessLocationLat: null,
    businessLocationLng: null,
    leadContactMethods: [],
    landingPageUrl: '',
    businessPhone: '',
    phoneCountryCode: '+1',
    whatsAppNumber: '',
    whatsAppMessage: '',
    bookingPageUrl: '',
    googleLeadFormHeadline: 'Get a Free Quote',
    googleLeadFormDescription:
      'Tell us what you need and our team will contact you.',
    googleLeadFormFields: ['FULL_NAME', 'EMAIL', 'PHONE'],
    googleLeadFormCta: 'GET_QUOTE',
    googleLeadFormCtaDescription: 'Get your free quote today',
    googleLeadFormPrivacyUrl: '',
    googleLeadFormThankYouHeadline: 'Thank you!',
    googleLeadFormThankYouMessage: "We'll contact you shortly.",
    googleLeadFormPostSubmitAction: 'VISIT_WEBSITE',
    googleLeadFormPostSubmitUrl: '',
    trafficAction: null,
    businessAddress: '',
    businessHours: '',
    appName: '',
    campaignName: '',
    businessName: '',
    websiteUrl: '',
    businessCategory: '',
    logoPreviewUrl: '',
    logoFileName: '',
    businessDescription: '',
    onboardingDone: false,
    dailyBudget: 40,
    startDate: '',
    endDate: '',
    countries: [],
    regions: [],
    cities: [],
    targetLocations: [],
    excludedLocationTargets: [],
    radiusTargeting: '',
    radiusEnabled: false,
    radiusCenter: null,
    radiusLat: null,
    radiusLng: null,
    radiusValue: 16,
    radiusUnit: 'KILOMETERS',
    excludedLocations: [],
    presenceOption: 'PRESENCE',
    languages: ['English'],
    idealCustomers: [],
    ageRanges: ['25-34', '35-44'],
    gender: 'ALL',
    householdIncome: '',
    interests: [],
    productsServices: [],
    businessType: '',
    suggestedKeywords: [],
    customKeywords: [],
    negativeKeywords: [],
    keywordMatchType: 'BROAD',
    ads: [
      {
        id: `ad_${Date.now()}`,
        finalUrl: '',
        headlines: ['', '', ''],
        descriptions: ['', ''],
        path1: '',
        path2: '',
        callToAction: 'LEARN_MORE',
      },
    ],
    adsGenerated: false,
    extensionBusinessName: '',
    phoneNumber: '',
    callouts: [],
    structuredSnippetHeader: 'Services',
    structuredSnippetValues: [],
    useLocationExtension: false,
    sitelinks: [],
    assetsGenerated: false,
    campaignType: 'SEARCH',
    bidStrategy: 'MAXIMIZE_CLICKS',
    targetCpa: '',
    targetRoas: '',
    adSchedule: '',
    deviceTargeting: ['Mobile', 'Desktop', 'Tablet'],
    networkSelection: ['Google Search'],
    ipExclusions: '',
    urlTrackingParams: '',
    conversionGoals: '',
    brandExclusions: '',
    frequencyCapping: '',
    contentExclusions: '',
    audienceExpansion: false,
    savedAt: null,
    currentStep: 1,
  };
}

export function generateGoogleCampaignName(
  goal: GoogleCampaignGoalId | null,
  businessName?: string,
): string {
  const month = new Date().toLocaleString('en-US', { month: 'short' });
  const brand = businessName?.trim();

  switch (goal) {
    case 'SALES':
      return brand ? `${brand} Sales - ${month}` : `Sales Campaign - ${month}`;
    case 'LEADS':
      return brand ? `${brand} Leads - ${month}` : `Lead Campaign - ${month}`;
    case 'WEBSITE_TRAFFIC':
      return brand ? `${brand} Traffic` : 'Traffic Campaign';
    case 'AWARENESS':
      return brand ? `${brand} Promotion` : 'Business Promotion Campaign';
    case 'LOCAL_VISITS':
      return brand
        ? `${brand} Local Visits - ${month}`
        : `Local Visits - ${month}`;
    case 'APP_PROMOTION':
      return brand ? `${brand} App` : 'App Promotion Campaign';
    default:
      return brand ? `${brand} Campaign` : 'New Campaign';
  }
}
