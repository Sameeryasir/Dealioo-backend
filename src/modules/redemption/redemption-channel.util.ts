import { CustomerVisitSource } from '../../db/entities/customer-visit.entity';
import { RedemptionChannel } from './dto/scan-qr.dto';

export function redemptionChannelToVisitSource(
  channel?: RedemptionChannel | null,
): CustomerVisitSource {
  if (channel === RedemptionChannel.STAFF_LOOKUP) {
    return CustomerVisitSource.STAFF_LOOKUP;
  }
  return CustomerVisitSource.QR_REDEMPTION;
}
