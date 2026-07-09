import { BadRequestException } from '@nestjs/common';
import { Business } from '../../db/entities/business.entity';

/**
 * Per-business Facebook credentials — never shared across businesses.
 * Every Graph API call must load credentials from the target business row.
 */
export type BusinessFacebookCredentials = {
  businessId: number;
  facebookUserId: string;
  accessToken: string;
  adAccountId: string | null;
};

export function extractBusinessFacebookCredentials(
  business: Business,
): BusinessFacebookCredentials | null {
  const accessToken = business.metaAccessToken?.trim();
  const facebookUserId = business.metaUserId?.trim();

  if (!accessToken || !facebookUserId) {
    return null;
  }

  return {
    businessId: business.id,
    facebookUserId,
    accessToken,
    adAccountId: business.metaAdAccountId?.trim() ?? null,
  };
}

export function requireBusinessFacebookCredentials(
  business: Business,
  notConnectedMessage = 'Facebook is not connected for this business. Connect Facebook in settings first.',
): BusinessFacebookCredentials {
  const credentials = extractBusinessFacebookCredentials(business);

  if (!credentials) {
    throw new BadRequestException(notConnectedMessage);
  }

  return credentials;
}
