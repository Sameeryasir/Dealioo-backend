import type { PaginationMeta } from '../../../common/pagination';
import type { AutomationExecution } from '../../../db/entities/automation-execution.entity';

export type ExecutionListSummary = {
  completed: number;
  inProgress: number;
  customersReached: number;
};

export class PaginatedExecutionsResponseDto {
  data: AutomationExecution[];
  meta: PaginationMeta & {
    summary?: ExecutionListSummary;
  };
}
