import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AiMessagePage } from '../../../db/entities/ai-message-page';
import { AiMessageRole } from '../../../db/entities/ai-message-role';

export class CreateAiMessageDto {
  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsEnum(AiMessagePage)
  pageId?: AiMessagePage;

  @IsOptional()
  @IsEnum(AiMessageRole)
  role?: AiMessageRole;
}
