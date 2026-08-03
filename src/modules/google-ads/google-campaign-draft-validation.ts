import { BadRequestException } from '@nestjs/common';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';

export type GoogleDraftValidationError = {
  step: number;
  field: string;
  message: string;
};

export const GOOGLE_REQUIRED_PUBLISH_STEPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;
export const PATH_MAX = 15;

function isValidHttpUrl(value?: string | null): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidHttpsUrl(value?: string | null): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeHostname(value?: string | null): string | null {
  if (!isValidHttpUrl(value)) return null;
  try {
    return new URL(value!.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function assertRequiredStepsCompleted(
  completedSteps: number[] | null | undefined,
  errors: GoogleDraftValidationError[],
): void {
  const done = new Set(completedSteps ?? []);
  const missing = GOOGLE_REQUIRED_PUBLISH_STEPS.filter((step) => !done.has(step));
  if (missing.length > 0) {
    errors.push({
      step: missing[0],
      field: 'completedSteps',
      message:
        'Complete all required builder steps (goal through ads) before publishing.',
    });
  }
}

export function validateGoogleDraftForPublish(
  draft: GoogleCampaignBuilderDraftData | null | undefined,
  options?: { completedSteps?: number[] | null },
): GoogleDraftValidationError[] {
  const errors: GoogleDraftValidationError[] = [];

  if (!draft) {
    errors.push({
      step: 1,
      field: 'draftData',
      message: 'Draft data is missing.',
    });
    return errors;
  }

  assertRequiredStepsCompleted(options?.completedSteps, errors);

  if (!draft.goal) {
    errors.push({
      step: 1,
      field: 'goal',
      message: 'Choose what you want to achieve.',
    });
  }

  if (draft.goal === 'SALES') {
    if (!draft.salesChannel) {
      errors.push({
        step: 2,
        field: 'salesChannel',
        message: 'Choose how customers buy from you.',
      });
    } else {
      const needsWebsite =
        draft.salesChannel === 'WEBSITE' ||
        draft.salesChannel === 'ONLINE_STORE' ||
        draft.salesChannel === 'MULTIPLE';
      const needsLocation =
        draft.salesChannel === 'PHYSICAL_STORE' ||
        draft.salesChannel === 'MULTIPLE';
      const needsPhone = draft.salesChannel === 'PHONE_ORDERS';

      if (needsWebsite && !isValidHttpUrl(draft.websiteUrl)) {
        errors.push({
          step: 2,
          field: 'websiteUrl',
          message: 'Enter a valid website URL.',
        });
      }
      if (needsLocation && !draft.businessLocation?.trim()) {
        errors.push({
          step: 2,
          field: 'businessLocation',
          message: 'Add your business location.',
        });
      }
      if (needsPhone && !draft.businessPhone?.trim()) {
        errors.push({
          step: 2,
          field: 'businessPhone',
          message: 'Add a phone number.',
        });
      }
    }
  }

  if (draft.goal === 'LEADS') {
    if (!draft.leadContactMethods?.length) {
      errors.push({
        step: 2,
        field: 'leadContactMethods',
        message: 'Select at least one contact method.',
      });
    }
    if (
      draft.leadContactMethods?.includes('CONTACT_FORM') &&
      !isValidHttpUrl(draft.landingPageUrl || draft.websiteUrl)
    ) {
      errors.push({
        step: 2,
        field: 'landingPageUrl',
        message: 'Add a landing page URL.',
      });
    }
    if (
      draft.leadContactMethods?.includes('PHONE_CALLS') &&
      !draft.businessPhone?.trim()
    ) {
      errors.push({
        step: 2,
        field: 'businessPhone',
        message: 'Add a business phone number.',
      });
    }
  }

  if (draft.goal === 'WEBSITE_TRAFFIC') {
    if (!isValidHttpUrl(draft.websiteUrl)) {
      errors.push({
        step: 2,
        field: 'websiteUrl',
        message: 'Where should visitors go? Add a valid URL.',
      });
    }
    if (!draft.trafficAction) {
      errors.push({
        step: 2,
        field: 'trafficAction',
        message: 'Choose an action for visitors.',
      });
    }
  }

  if (draft.goal === 'AWARENESS') {
    if (!draft.businessName?.trim()) {
      errors.push({
        step: 2,
        field: 'businessName',
        message: 'Add your business name.',
      });
    }
    if (!draft.businessCategory?.trim()) {
      errors.push({
        step: 2,
        field: 'businessCategory',
        message: 'Choose a business category.',
      });
    }
  }

  if (draft.goal === 'APP_PROMOTION' && !draft.appName?.trim()) {
    errors.push({
      step: 2,
      field: 'appName',
      message: 'Add your app name.',
    });
  }

  if (!draft.campaignName?.trim()) {
    errors.push({
      step: 3,
      field: 'campaignName',
      message: 'Add a campaign name.',
    });
  }
  if (!draft.businessName?.trim()) {
    errors.push({
      step: 3,
      field: 'businessName',
      message: 'Add your business name.',
    });
  }
  if (draft.websiteUrl?.trim() && !isValidHttpUrl(draft.websiteUrl)) {
    errors.push({
      step: 3,
      field: 'websiteUrl',
      message: 'Enter a valid website URL.',
    });
  }

  if (!draft.dailyBudget || draft.dailyBudget < 1) {
    errors.push({
      step: 4,
      field: 'dailyBudget',
      message: 'Set a daily budget of at least $1.',
    });
  }
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.push({
      step: 4,
      field: 'endDate',
      message: 'End date must be on or after the start date.',
    });
  }

  if (!draft.targetLocations?.length) {
    errors.push({
      step: 5,
      field: 'targetLocations',
      message: 'Select at least one target location.',
    });
  }
  if (draft.radiusEnabled) {
    if (!draft.radiusValue || draft.radiusValue < 1) {
      errors.push({
        step: 5,
        field: 'radiusValue',
        message: 'Enter a radius of at least 1.',
      });
    }
    if (!draft.radiusCenter?.id && (draft.radiusLat == null || draft.radiusLng == null)) {
      errors.push({
        step: 5,
        field: 'radiusCenter',
        message: 'Pick a center point for radius targeting.',
      });
    }
  }

  if (!draft.languages?.length) {
    errors.push({
      step: 6,
      field: 'languages',
      message: 'Select at least one language.',
    });
  }

  if (!draft.ageRanges?.length) {
    errors.push({
      step: 7,
      field: 'ageRanges',
      message: 'Select at least one age group.',
    });
  }

  if (!draft.businessType?.trim()) {
    errors.push({
      step: 8,
      field: 'businessType',
      message: 'Choose your business type.',
    });
  } else {
    const enabledSuggested =
      draft.suggestedKeywords?.filter((row) => row.enabled && row.text.trim())
        .length ?? 0;
    const custom = draft.customKeywords?.filter((row) => row.trim()).length ?? 0;
    if (enabledSuggested + custom === 0) {
      errors.push({
        step: 8,
        field: 'keywords',
        message: 'Keep or add at least one keyword.',
      });
    }
  }

  const ad = draft.ads?.[0];
  if (!ad) {
    errors.push({
      step: 9,
      field: 'ads',
      message: 'Create at least one ad.',
    });
  } else {
    if (!isValidHttpUrl(ad.finalUrl)) {
      errors.push({
        step: 9,
        field: 'finalUrl',
        message: 'Add a valid final URL.',
      });
    }

    const headlines = ad.headlines.map((h) => h.trim()).filter(Boolean);
    if (headlines.length < 3) {
      errors.push({
        step: 9,
        field: 'headlines',
        message: 'Keep at least 3 headlines.',
      });
    } else if (headlines.some((h) => h.length > HEADLINE_MAX)) {
      errors.push({
        step: 9,
        field: 'headlines',
        message: `Each headline must be ${HEADLINE_MAX} characters or fewer.`,
      });
    }

    const descriptions = ad.descriptions.map((d) => d.trim()).filter(Boolean);
    if (descriptions.length < 2) {
      errors.push({
        step: 9,
        field: 'descriptions',
        message: 'Keep at least 2 descriptions.',
      });
    } else if (descriptions.some((d) => d.length > DESCRIPTION_MAX)) {
      errors.push({
        step: 9,
        field: 'descriptions',
        message: `Each description must be ${DESCRIPTION_MAX} characters or fewer.`,
      });
    }

    if (ad.path1?.trim() && ad.path1.trim().length > PATH_MAX) {
      errors.push({
        step: 9,
        field: 'path1',
        message: `Path 1 must be ${PATH_MAX} characters or fewer.`,
      });
    }
    if (ad.path2?.trim() && ad.path2.trim().length > PATH_MAX) {
      errors.push({
        step: 9,
        field: 'path2',
        message: `Path 2 must be ${PATH_MAX} characters or fewer.`,
      });
    }
  }

  if (draft.bidStrategy === 'TARGET_CPA' && !draft.targetCpa?.trim()) {
    errors.push({
      step: 4,
      field: 'targetCpa',
      message: 'Enter a target CPA for this bid strategy.',
    });
  }
  if (draft.bidStrategy === 'TARGET_ROAS' && !draft.targetRoas?.trim()) {
    errors.push({
      step: 4,
      field: 'targetRoas',
      message: 'Enter a target ROAS for this bid strategy.',
    });
  }

  for (const link of draft.sitelinks ?? []) {
    if (!link.enabled) continue;
    if (!link.text?.trim()) {
      errors.push({
        step: 10,
        field: 'sitelinks',
        message: 'Enabled sitelinks need a link label.',
      });
      break;
    }
    const url = link.url?.trim() ?? '';
    if (!url.toLowerCase().startsWith('https://') || !isValidHttpsUrl(url)) {
      errors.push({
        step: 10,
        field: 'sitelinks',
        message: 'Enabled sitelinks need a valid URL that begins with https://.',
      });
      break;
    }
  }

  const websiteHost = safeHostname(draft.websiteUrl);
  const finalHost = safeHostname(ad?.finalUrl);
  if (
    draft.goal === 'SALES' &&
    (draft.salesChannel === 'WEBSITE' ||
      draft.salesChannel === 'ONLINE_STORE' ||
      draft.salesChannel === 'MULTIPLE') &&
    websiteHost &&
    finalHost &&
    websiteHost !== finalHost
  ) {
    errors.push({
      step: 9,
      field: 'finalUrl',
      message: 'Ad final URL should use the same website domain as your sales site.',
    });
  }

  return errors;
}

export function assertPublishValidation(
  draft: GoogleCampaignBuilderDraftData | null | undefined,
  completedSteps?: number[] | null,
): void {
  const errors = validateGoogleDraftForPublish(draft, { completedSteps });
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Draft failed publish validation.',
      errors,
    });
  }
}
