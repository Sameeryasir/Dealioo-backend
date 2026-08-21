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
    const methods = (draft.leadContactMethods ?? []).filter(
      (id) => id !== 'WHATSAPP' && id !== 'APPOINTMENT_BOOKING',
    );
    const primary = methods[0] ?? null;
    if (!primary || methods.length !== 1) {
      errors.push({
        step: 2,
        field: 'leadContactMethods',
        message: 'Choose one primary lead method.',
      });
    }
    if (
      primary === 'CONTACT_FORM' &&
      !isValidHttpUrl(draft.landingPageUrl || draft.websiteUrl)
    ) {
      errors.push({
        step: 2,
        field: 'landingPageUrl',
        message: 'Add a landing page URL.',
      });
    }
    if (primary === 'GOOGLE_LEAD_FORM') {
      if (!draft.businessName?.trim()) {
        errors.push({
          step: 2,
          field: 'businessName',
          message: 'Add a business name.',
        });
      }
      if (!draft.googleLeadFormHeadline?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormHeadline',
          message: 'Add a lead form headline.',
        });
      }
      if (!draft.googleLeadFormDescription?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormDescription',
          message: 'Add a lead form description.',
        });
      }
      if (!draft.googleLeadFormCta?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormCta',
          message: 'Choose a call to action.',
        });
      }
      if (!draft.googleLeadFormCtaDescription?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormCtaDescription',
          message: 'Add a CTA description.',
        });
      }
      if (!draft.googleLeadFormFields?.length) {
        errors.push({
          step: 2,
          field: 'googleLeadFormFields',
          message: 'Select at least one form field.',
        });
      }
      if (!isValidHttpUrl(draft.googleLeadFormPrivacyUrl)) {
        errors.push({
          step: 2,
          field: 'googleLeadFormPrivacyUrl',
          message: 'Add a privacy policy URL.',
        });
      }
      if (!draft.googleLeadFormThankYouHeadline?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormThankYouHeadline',
          message: 'Add a thank-you headline.',
        });
      }
      if (!draft.googleLeadFormThankYouMessage?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormThankYouMessage',
          message: 'Add a thank-you message.',
        });
      }
      if (!draft.googleLeadFormPostSubmitAction?.trim()) {
        errors.push({
          step: 2,
          field: 'googleLeadFormPostSubmitAction',
          message: 'Choose a post-submit action.',
        });
      }
      if (
        draft.googleLeadFormPostSubmitAction === 'VISIT_WEBSITE' &&
        !isValidHttpUrl(
          draft.googleLeadFormPostSubmitUrl ||
            draft.websiteUrl ||
            draft.landingPageUrl,
        )
      ) {
        errors.push({
          step: 2,
          field: 'googleLeadFormPostSubmitUrl',
          message: 'Add a website URL for the post-submit action.',
        });
      }
    }
    if (primary === 'PHONE_CALLS' && !draft.businessPhone?.trim()) {
      errors.push({
        step: 2,
        field: 'businessPhone',
        message: 'Add a phone number.',
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
  }

  if (draft.goal === 'LOCAL_VISITS') {
    if (!draft.businessLocation?.trim()) {
      errors.push({
        step: 2,
        field: 'businessLocation',
        message: 'Add your business location.',
      });
    }
    if (!draft.businessPhone?.trim()) {
      errors.push({
        step: 2,
        field: 'businessPhone',
        message: 'Add a phone number.',
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

  const hasPinLocation = (draft.targetLocations ?? []).some(
    (row) => row.type !== 'country',
  );

  if (hasPinLocation || draft.radiusEnabled) {
    const pinWithoutRadius = (draft.targetLocations ?? []).find((row) => {
      if (row.type === 'country') return false;
      const hasCoords =
        typeof row.latitude === 'number' && typeof row.longitude === 'number';
      const hasRadius =
        typeof row.radiusValue === 'number' && row.radiusValue >= 1;
      return !hasCoords || !hasRadius;
    });
    if (pinWithoutRadius) {
      errors.push({
        step: 5,
        field: 'radiusValue',
        message: `Set a map radius for ${pinWithoutRadius.name}.`,
      });
      errors.push({
        step: 5,
        field: 'radiusCenter',
        message: `Click ${pinWithoutRadius.name} and set its radius on the map before publishing.`,
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
        message: 'Add at least 3 headlines.',
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
        message: 'Add at least 2 descriptions.',
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
  if (
    draft.containsEuPoliticalAdvertising !== true &&
    draft.containsEuPoliticalAdvertising !== false
  ) {
    errors.push({
      step: 4,
      field: 'containsEuPoliticalAdvertising',
      message: 'Confirm if your campaign has EU political ads.',
    });
  }

  for (const link of draft.sitelinks ?? []) {
    if (!link.enabled) continue;
    if (!link.text?.trim()) {
      errors.push({
        step: 7,
        field: 'sitelinks',
        message: 'Enabled sitelinks need a link label.',
      });
      break;
    }
    const url = link.url?.trim() ?? '';
    if (!url.toLowerCase().startsWith('https://') || !isValidHttpsUrl(url)) {
      errors.push({
        step: 7,
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
