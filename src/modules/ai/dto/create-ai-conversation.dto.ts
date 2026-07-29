import { IsInt, IsPositive } from 'class-validator';

export class CreateAiConversationDto {
  @IsInt()
  @IsPositive()
  businessId!: number;

  @IsInt()
  @IsPositive()
  funnelId!: number;
}
