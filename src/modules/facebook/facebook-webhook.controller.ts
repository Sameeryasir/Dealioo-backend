import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { FacebookService } from './facebook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('facebook')
export class FacebookWebhookController {
  private readonly logger = new Logger(FacebookWebhookController.name);

  constructor(private readonly facebookService: FacebookService) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    this.logger.log('Facebook webhook verification request');
    return this.facebookService.verifyWebhook(mode, verifyToken, challenge);
  }

  @Post('webhook')
  @HttpCode(200)
  receiveWebhook(
    @Req() req: RawBodyRequest,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
    @Body() body: unknown,
  ): { received: boolean } {
    this.assertValidWebhookSignature(req, signatureHeader);
    this.facebookService.logWebhookPayload(body);
    return { received: true };
  }

  private assertValidWebhookSignature(
    req: RawBodyRequest,
    signatureHeader: string | undefined,
  ): void {
    const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
    if (!appSecret) {
      throw new ForbiddenException('Facebook app secret is not configured.');
    }

    const signature = signatureHeader?.trim();
    if (!signature?.startsWith('sha256=')) {
      throw new ForbiddenException('Missing Meta webhook signature.');
    }

    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new ForbiddenException('Missing raw webhook body for signature check.');
    }

    const expected =
      'sha256=' +
      createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (
      provided.length !== expectedBuf.length ||
      !timingSafeEqual(provided, expectedBuf)
    ) {
      throw new ForbiddenException('Invalid Meta webhook signature.');
    }
  }
}
