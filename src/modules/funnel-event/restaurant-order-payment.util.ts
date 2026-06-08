import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';

export type RestaurantOrderPaymentStatus =
  | 'not_paid'
  | 'paid_online'
  | 'paid_walk_in'
  | 'paid_both';

export type RestaurantVisitSnapshot = {
  orderSubtotal: number;
  visitedAt: Date;
};

export type RestaurantOrderPaymentSummary = {
  orderStatus: RestaurantOrderPaymentStatus;
  onlineAmountCents: number | null;
  restaurantAmount: number | null;
  restaurantVisitedAt: Date | null;
};

export function customerFunnelVisitKey(
  customerId: number,
  funnelId: number,
): string {
  return `${customerId}:${funnelId}`;
}

export function buildRestaurantOrderPaymentSummary(
  event: Pick<FunnelEvent, 'eventType' | 'amount'>,
  visit: RestaurantVisitSnapshot | null,
): RestaurantOrderPaymentSummary {
  const onlineAmountCents =
    event.eventType === FunnelEventType.PAYMENT && event.amount != null
      ? event.amount
      : null;
  const restaurantAmount =
    visit?.orderSubtotal != null ? Number(visit.orderSubtotal) : null;

  const hasOnline = onlineAmountCents != null && onlineAmountCents > 0;
  const hasRestaurant = restaurantAmount != null && restaurantAmount > 0;

  let orderStatus: RestaurantOrderPaymentStatus = 'not_paid';
  if (hasOnline && hasRestaurant) {
    orderStatus = 'paid_both';
  } else if (hasOnline) {
    orderStatus = 'paid_online';
  } else if (hasRestaurant) {
    orderStatus = 'paid_walk_in';
  } else if (event.eventType === FunnelEventType.PAYMENT) {
    orderStatus = 'paid_online';
  }

  return {
    orderStatus,
    onlineAmountCents: hasOnline ? onlineAmountCents : null,
    restaurantAmount: hasRestaurant ? restaurantAmount : null,
    restaurantVisitedAt: visit?.visitedAt ?? null,
  };
}
