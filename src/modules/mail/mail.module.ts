import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrevoService } from './brevo.service';
import { MailDeliveryService } from './mail-delivery.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [BrevoService, MailDeliveryService],
  exports: [BrevoService, MailDeliveryService],
})
export class MailModule {}
