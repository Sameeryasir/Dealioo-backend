import { CustomerVisitSource } from '../../db/entities/customer-visit.entity';

export function visitedActivityDescription(
  businessName: string,
  source: CustomerVisitSource = CustomerVisitSource.QR_REDEMPTION,
): string {
  const location = businessName.trim() || 'Business';
  if (source === CustomerVisitSource.STAFF_LOOKUP) {
    return `Checked in at ${location}`;
  }
  return `Scanned at ${location}`;
}
