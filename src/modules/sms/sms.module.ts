import { Global, Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SmsController } from './sms.controller';
import { TwilioInboundService } from './twilio-inbound.service';
import { TwilioService } from './twilio.service';

@Global()
@Module({
  imports: [ChatModule],
  controllers: [SmsController],
  providers: [TwilioService, TwilioInboundService],
  exports: [TwilioService],
})
export class SmsModule {}
