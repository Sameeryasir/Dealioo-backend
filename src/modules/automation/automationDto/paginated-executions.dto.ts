import type { PaginationMeta } from '../../../common/pagination';
import { AutomationExecutionStatus } from '../../../db/entities/automation-execution.entity';

export type ExecutionListSummary = {
  completed: number;
  inProgress: number;
  customersReached: number;
};

export class ExecutionListItemDto {
  runId: number;
  id: number;
  status: AutomationExecutionStatus;
  startedAt: Date;
  customerCount: number;
  customerId: number | null;
  customerEmail: string | null;
  customerName: string | null;
  totalRecipients: number;
  emailsSentCount: number;
  scheduledAt: Date | null;
  stepType: string | null;
}

export class PaginatedExecutionsResponseDto {
  data: ExecutionListItemDto[];
  meta: PaginationMeta & {
    summary?: ExecutionListSummary;
  };
}
