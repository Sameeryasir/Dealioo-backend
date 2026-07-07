import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim() || null;

    return {
      status: 'ok',
      service: 'retention-backend',
      publicBaseUrl,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
