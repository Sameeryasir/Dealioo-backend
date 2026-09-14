import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { runAfterTransactionCommit } from '../../common/run-after-transaction-commit.util';
import { SidebarSectionNotifyService } from './sidebar-section-notify.service';

@Injectable()
@EventSubscriber()
export class FunnelPaymentSidebarUnreadSubscriber
  implements EntitySubscriberInterface<FunnelPayment>
{
  constructor(
    dataSource: DataSource,
    private readonly sidebarNotify: SidebarSectionNotifyService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return FunnelPayment;
  }

  afterInsert(event: InsertEvent<FunnelPayment>): void {
    runAfterTransactionCommit(event.manager, () => this.notify(event.entity));
  }

  afterUpdate(event: UpdateEvent<FunnelPayment>): void {
    const entity = (event.entity ?? event.databaseEntity) as
      | FunnelPayment
      | undefined;
    runAfterTransactionCommit(event.manager, () => this.notify(entity));
  }

  private notify(payment: FunnelPayment | null | undefined): void {
    if (!payment) return;
    if (payment.businessId == null || payment.businessId < 1) return;
    if (payment.status !== FunnelPaymentStatus.PAID) return;
    if (payment.orderId == null || payment.orderId < 1) return;

    this.sidebarNotify.notifyOrders({
      businessId: payment.businessId,
      actorUserId: payment.paymentCollectedBy,
      occurredAt: payment.paidAt ?? payment.paymentCollectedAt ?? payment.updatedAt,
    });
  }
}
