import type { PaginationMeta } from '../../../common/pagination';
import { Automation } from '../../../db/entities/automation.entity';

export class PaginatedAutomationsResponseDto {
  data: Automation[];
  meta: PaginationMeta;
}
