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
import { TWILIO_SIGNATURE_HEADER } from './constants/twilio-inbound.constants';
import { TwilioInboundService } from './twilio-inbound.service';

type TwilioWebhookRequest = Request & {
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
    @Req() req: TwilioWebhookRequest,
    @Headers(TWILIO_SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<string> {
    return this.twilioInboundService.handleInbound(
      req.body ?? {},
      signature,
      req,
    );
  }

  @Post('status')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  handleStatusCallback(
    @Req() req: TwilioWebhookRequest,
    @Headers(TWILIO_SIGNATURE_HEADER) signature: string | undefined,
  ): Promise<string> {
    return this.twilioInboundService.handleStatusCallback(
      req.body ?? {},
      signature,
      req,
    );
  }
}
