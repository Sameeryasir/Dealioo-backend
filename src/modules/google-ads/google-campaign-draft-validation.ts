import { BadRequestException } from '@nestjs/common';
import type { GoogleCampaignBuilderDraftData } from '../../db/entities/google-campaign-builder-draft.types';

export type GoogleDraftValidationError = {
  step: number;
  field: string;
  message: string;
};

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

export function validateGoogleDraftForPublish(
  draft: GoogleCampaignBuilderDraftData | null | undefined,
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
    } else if (
      (draft.salesChannel === 'WEBSITE' ||
        draft.salesChannel === 'ONLINE_STORE' ||
        draft.salesChannel === 'MULTIPLE') &&
      !isValidHttpUrl(draft.websiteUrl)
    ) {
      errors.push({
        step: 2,
        field: 'websiteUrl',
        message: 'Enter a valid website URL.',
      });
    } else if (
      (draft.salesChannel === 'PHYSICAL_STORE' ||
        draft.salesChannel === 'MULTIPLE') &&
      !draft.businessLocation?.trim()
    ) {
      errors.push({
        step: 2,
        field: 'businessLocation',
        message: 'Add your business location.',
      });
    } else if (
      draft.salesChannel === 'PHONE_ORDERS' &&
      !draft.businessPhone?.trim()
    ) {
      errors.push({
        step: 2,
        field: 'businessPhone',
        message: 'Add a phone number.',
      });
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
  if (
    draft.startDate &&
    draft.endDate &&
    draft.endDate < draft.startDate
  ) {
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
  if (draft.radiusEnabled && (!draft.radiusValue || draft.radiusValue < 1)) {
    errors.push({
      step: 5,
      field: 'radiusValue',
      message: 'Enter a radius of at least 1.',
    });
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
    if (ad.headlines.map((h) => h.trim()).filter(Boolean).length < 3) {
      errors.push({
        step: 9,
        field: 'headlines',
        message: 'Keep at least 3 headlines.',
      });
    }
    if (ad.descriptions.map((d) => d.trim()).filter(Boolean).length < 2) {
      errors.push({
        step: 9,
        field: 'descriptions',
        message: 'Keep at least 2 descriptions.',
      });
    }
  }

  if (
    draft.goal === 'SALES' &&
    (draft.salesChannel === 'WEBSITE' ||
      draft.salesChannel === 'ONLINE_STORE' ||
      draft.salesChannel === 'MULTIPLE') &&
    draft.websiteUrl?.trim() &&
    ad?.finalUrl?.trim() &&
    new URL(draft.websiteUrl).hostname !==
      (() => {
        try {
          return new URL(ad.finalUrl).hostname;
        } catch {
          return '';
        }
      })()
  ) {
    
    
  }

  return errors;
}

export function assertPublishValidation(
  draft: GoogleCampaignBuilderDraftData | null | undefined,
): void {
  const errors = validateGoogleDraftForPublish(draft);
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Draft failed publish validation.',
      errors,
    });
  }
}
