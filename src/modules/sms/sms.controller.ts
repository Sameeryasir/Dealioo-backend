import {
  Controller,
  Header,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TwilioInboundService } from './twilio-inbound.service';

type TwilioInboundRequest = Request & {
  body: Record<string, string>;
};

@SkipThrottle()
@Controller('sms/twilio')
export class SmsController {
  constructor(private readonly twilioInboundService: TwilioInboundService) {}

  @Post('inbound')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  handleInboundSms(
    @Req() req: TwilioInboundRequest,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<string> {
    return this.twilioInboundService.handleInbound(
      req.body ?? {},
      signature,
      req,
    );
  }
}
