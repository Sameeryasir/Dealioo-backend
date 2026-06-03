import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { FacebookService } from './facebook.service';

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
  receiveWebhook(@Body() body: unknown): { received: boolean } {
    this.facebookService.logWebhookPayload(body);
    return { received: true };
  }
}
