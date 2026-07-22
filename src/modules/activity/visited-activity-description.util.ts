import { CustomerVisitSource } from '../../db/entities/customer-visit.entity';

export function visitedActivityDescription(
  businessName: string,
  source: CustomerVisitSource = CustomerVisitSource.QR_REDEMPTION,
  offerName?: string | null,
): string {
  const location = businessName.trim() || 'Business';
  const offer = offerName?.trim() || null;

  if (source === CustomerVisitSource.STAFF_LOOKUP) {
    return offer
      ? `Checked in for ${offer} at ${location}`
      : `Checked in at ${location}`;
  }

  return offer
    ? `Scanned ${offer} at ${location}`
    : `Scanned at ${location}`;
}
