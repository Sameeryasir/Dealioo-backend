import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { GoogleWalletCallbackDto } from './dto/google-wallet-callback.dto';
import { GoogleWalletCallbackResultDto } from './dto/google-wallet-callback-result.dto';
import { GoogleWalletService } from './google-wallet.service';

@Controller('google-wallet')
export class GoogleWalletController {
  private readonly logger = new Logger(GoogleWalletController.name);

  constructor(private readonly googleWalletService: GoogleWalletService) {}

  @Post('callback')
  @HttpCode(200)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async handleCallback(
    @Body() dto: GoogleWalletCallbackDto,
    @Headers('user-agent') userAgent?: string,
    @Req() req?: Request,
  ): Promise<GoogleWalletCallbackResultDto> {
    const bodyKeys = dto && typeof dto === 'object' ? Object.keys(dto) : [];
    this.logger.log(
      `Google Wallet webhook HIT path=${req?.originalUrl ?? '/api/google-wallet/callback'} ua=${userAgent ?? '(none)'} bodyKeys=${bodyKeys.join(',') || '(empty)'}`,
    );

    const result = await this.googleWalletService.handleCallback(dto);

    this.logger.log(
      `Google Wallet webhook RESPONSE ${JSON.stringify(result)}`,
    );
    return result;
  }
}
