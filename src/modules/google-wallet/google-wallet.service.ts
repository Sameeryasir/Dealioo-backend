import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { CreateGoogleWalletSaveLinkDto } from './dto/create-google-wallet-save-link.dto';
import { GoogleWalletSaveLinkResultDto } from './dto/google-wallet-save-link-result.dto';

@Injectable()
export class GoogleWalletService {
  private readonly logger = new Logger(GoogleWalletService.name);

  private readonly issuerId: string;
  private readonly classSuffix: string;
  private readonly serviceAccountEmail: string;
  private readonly privateKeyPem: string;
  private readonly origins: string[];

  constructor(private readonly configService: ConfigService) {
    this.issuerId =
      this.configService.get<string>('GOOGLE_WALLET_ISSUER_ID')?.trim() || '';
    this.classSuffix =
      this.configService.get<string>('GOOGLE_WALLET_CLASS_ID')?.trim() || '';
    this.serviceAccountEmail =
      this.configService
        .get<string>('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL')
        ?.trim() || '';
    this.privateKeyPem = this.normalizePrivateKey(
      this.configService.get<string>('GOOGLE_WALLET_PRIVATE_KEY') || '',
    );
    this.origins = this.resolveOrigins();

    if (
      !this.issuerId ||
      !this.classSuffix ||
      !this.serviceAccountEmail ||
      !this.privateKeyPem
    ) {
      throw new Error(
        'GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL, and GOOGLE_WALLET_PRIVATE_KEY must be set.',
      );
    }
  }

  createSaveLink(
    pass: CreateGoogleWalletSaveLinkDto,
  ): GoogleWalletSaveLinkResultDto {
    const passId = pass.passId?.trim();
    const offerName = pass.offerName?.trim();
    const businessName = pass.businessName?.trim();
    const qrOrRedemptionUrl = pass.qrOrRedemptionUrl?.trim();
    const qrToken = pass.qrToken?.trim();

    if (!passId || !offerName || !businessName || !qrOrRedemptionUrl || !qrToken) {
      throw new InternalServerErrorException(
        'Google Wallet pass requires passId, offerName, businessName, qrOrRedemptionUrl, and qrToken.',
      );
    }

    const objectSuffix = this.buildUniqueObjectSuffix(passId);
    const classSuffix = this.classSuffix.includes('.')
      ? this.classSuffix.split('.').pop()!
      : this.classSuffix;
    const objectId = `${this.issuerId}.${objectSuffix}`;
    const classId = `${this.issuerId}.${classSuffix}`;

    const couponIdNum = Number(passId);
    const barcodePayload = JSON.stringify({
      couponId: Number.isFinite(couponIdNum) ? couponIdNum : passId,
      token: qrToken,
    });

    // Env class is a Google Wallet genericClass (not offerClass).
    const genericObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      cardTitle: {
        defaultValue: {
          language: 'en-US',
          value: businessName,
        },
      },
      header: {
        defaultValue: {
          language: 'en-US',
          value: offerName,
        },
      },
      barcode: {
        type: 'QR_CODE',
        value: barcodePayload,
        alternateText: offerName,
      },
      textModulesData: [
        {
          id: 'business',
          header: 'Business',
          body: businessName,
        },
        {
          id: 'offer',
          header: 'Offer',
          body: offerName,
        },
      ],
      linksModuleData: {
        uris: [
          {
            uri: qrOrRedemptionUrl,
            description: 'Open Dealioo pass',
            id: 'dealioo_pass',
          },
        ],
      },
    };

    const claims = {
      iss: this.serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      origins: this.origins,
      payload: {
        genericObjects: [genericObject],
      },
    };

    let signedJwt: string;
    try {
      signedJwt = jwt.sign(claims, this.privateKeyPem, {
        algorithm: 'RS256',
      });
    } catch (err) {
      this.logger.error(
        `Google Wallet JWT sign failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException(
        'Could not sign Google Wallet pass. Check GOOGLE_WALLET_PRIVATE_KEY.',
      );
    }

    const saveUrl = `https://pay.google.com/gp/v/save/${signedJwt}`;

    this.logger.log(
      `Google Wallet save link created objectId=${objectId} classId=${classId} passId=${passId}`,
    );

    return { saveUrl, objectId, classId };
  }

  private buildUniqueObjectSuffix(passId: string): string {
    const safePassId = passId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const nonce = randomBytes(4).toString('hex');
    return `dealioo_${safePassId}_${nonce}`;
  }

  private normalizePrivateKey(raw: string): string {
    let key = raw.trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1);
    }
    return key.replace(/\\n/g, '\n').trim();
  }

  private resolveOrigins(): string[] {
    const frontendRaw =
      this.configService.get<string>('FRONTEND_URL')?.trim() || '';
    const fromFrontend = frontendRaw
      .split(',')
      .map((part) => part.trim().replace(/\/$/, ''))
      .filter(Boolean);

    const defaults = ['http://localhost:3002', 'https://www.dealioo.io'];
    return [...new Set([...fromFrontend, ...defaults])];
  }
}
