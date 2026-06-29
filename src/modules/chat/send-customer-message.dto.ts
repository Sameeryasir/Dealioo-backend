import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ConversationMessageChannel } from '../../db/entities/conversation-message.entity';

export class SendCustomerMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsIn([
    ConversationMessageChannel.EMAIL,
    ConversationMessageChannel.SMS,
    ConversationMessageChannel.WHATSAPP,
  ])
  channel?: ConversationMessageChannel;
}
