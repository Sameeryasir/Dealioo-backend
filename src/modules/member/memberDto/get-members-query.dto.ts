import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

export class GetMembersQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  businessId: number;
}
