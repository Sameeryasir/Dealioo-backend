import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { Order, OrderSource } from '../../db/entities/order.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { runAfterTransactionCommit } from '../../common/run-after-transaction-commit.util';
import { SidebarSectionNotifyService } from './sidebar-section-notify.service';

@Injectable()
@EventSubscriber()
export class OrderSidebarUnreadSubscriber
  implements EntitySubscriberInterface<Order>
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly sidebarNotify: SidebarSectionNotifyService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Order;
  }

  afterInsert(event: InsertEvent<Order>): void {
    runAfterTransactionCommit(event.manager, () => {
      void this.notify(event.entity);
    });
  }

  afterUpdate(event: UpdateEvent<Order>): void {
    const entity = (event.entity ?? event.databaseEntity) as
      | Order
      | undefined;
    runAfterTransactionCommit(event.manager, () => {
      void this.notify(entity);
    });
  }

  private async notify(order: Order | null | undefined): Promise<void> {
    if (!order || order.businessId == null || order.businessId < 1) return;

    const actorUserId = await this.resolveCollectorUserId(order.id);

    if (actorUserId == null && order.source === OrderSource.SCANNER) {
      return;
    }

    this.sidebarNotify.notifyOrders({
      businessId: order.businessId,
      actorUserId,
      occurredAt: order.paidAt ?? order.updatedAt ?? order.createdAt,
    });
  }

  private async resolveCollectorUserId(
    orderId: number | null | undefined,
  ): Promise<number | null> {
    if (orderId == null || orderId < 1) return null;
    try {
      const row = await this.dataSource.getRepository(FunnelPayment).findOne({
        where: { orderId },
        order: { id: 'DESC' },
        select: ['paymentCollectedBy'],
      });
      return this.sidebarNotify.normalizeActorUserId(row?.paymentCollectedBy);
    } catch {
      return null;
    }
  }
}
