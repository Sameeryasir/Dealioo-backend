import { Body, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GoogleWalletService } from './google-wallet.service';

@Controller('google-wallet')
export class GoogleWalletController {
  private readonly logger = new Logger(GoogleWalletController.name);

  constructor(private readonly googleWalletService: GoogleWalletService) {}

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Body() body: Record<string, unknown>,
    @Headers('user-agent') userAgent?: string,
    @Req() req?: Request,
  ) {
    const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : [];
    this.logger.log(
      `Google Wallet webhook HIT path=${req?.originalUrl ?? '/api/google-wallet/callback'} ua=${userAgent ?? '(none)'} bodyKeys=${bodyKeys.join(',') || '(empty)'}`,
    );

    const result = await this.googleWalletService.handleCallback(body);

    this.logger.log(
      `Google Wallet webhook RESPONSE ${JSON.stringify(result)}`,
    );
    return result;
  }
}
