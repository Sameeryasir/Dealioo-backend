import { Injectable } from '@nestjs/common';
import type { AiOperation } from '../interfaces/ai-operation.interface';

@Injectable()
export class AuditService {
  async recordOperation(_input: {
    operation: AiOperation;
    operationId: string;
    providerName: string;
    success: boolean;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    throw new Error('AuditService.recordOperation is not implemented yet.');
  }
}
