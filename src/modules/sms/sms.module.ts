import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
import { ChatModule } from '../chat/chat.module';
import { SmsController } from './sms.controller';
import { TwilioInboundService } from './twilio-inbound.service';
import { TwilioService } from './twilio.service';
import { TwilioWebhookValidatorService } from './twilio-webhook-validator.service';

@Global()
@Module({
  imports: [ChatModule, TypeOrmModule.forFeature([BusinessTwilioIntegration])],
  controllers: [SmsController],
  providers: [
    TwilioService,
    TwilioInboundService,
    TwilioWebhookValidatorService,
  ],
  exports: [TwilioService, TwilioWebhookValidatorService],
})
export class SmsModule {}
