import { BadRequestException } from '@nestjs/common';
import { Restaurant } from '../../db/entities/restaurant.entity';

/**
 * Per-restaurant Facebook credentials — never shared across restaurants.
 * Every Graph API call must load credentials from the target restaurant row.
 */
export type RestaurantFacebookCredentials = {
  restaurantId: number;
  facebookUserId: string;
  accessToken: string;
  adAccountId: string | null;
};

export function extractRestaurantFacebookCredentials(
  restaurant: Restaurant,
): RestaurantFacebookCredentials | null {
  const accessToken = restaurant.metaAccessToken?.trim();
  const facebookUserId = restaurant.metaUserId?.trim();

  if (!accessToken || !facebookUserId) {
    return null;
  }

  return {
    restaurantId: restaurant.id,
    facebookUserId,
    accessToken,
    adAccountId: restaurant.metaAdAccountId?.trim() ?? null,
  };
}

export function requireRestaurantFacebookCredentials(
  restaurant: Restaurant,
  notConnectedMessage = 'Facebook is not connected for this restaurant. Connect Facebook in settings first.',
): RestaurantFacebookCredentials {
  const credentials = extractRestaurantFacebookCredentials(restaurant);

  if (!credentials) {
    throw new BadRequestException(notConnectedMessage);
  }

  return credentials;
}
