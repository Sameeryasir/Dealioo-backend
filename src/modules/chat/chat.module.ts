import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { Conversation } from '../../db/entities/conversation.entity';
import { ConversationMessage } from '../../db/entities/conversation-message.entity';
import { Customer } from '../../db/entities/customer.entity';
import { BusinessUserChatReadState } from '../../db/entities/business-user-chat-read-state.entity';
import { AuthModule } from '../auth/auth.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { ChatController } from './chat.controller';
import { ChatMessageNotificationService } from './chat-message-notification.service';
import { ChatMessageService } from './chat-message.service';
import { ChatService } from './chat.service';
import { InboundMessageRecorderService } from './inbound-message-recorder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutomationExecution,
      AutomationLog,
      ActivityEvent,
      Conversation,
      ConversationMessage,
      Customer,
      BusinessUserChatReadState,
    ]),
    AuthModule,
    forwardRef(() => RedemptionModule),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatMessageService,
    ChatMessageNotificationService,
    InboundMessageRecorderService,
  ],
  exports: [
    ChatService,
    ChatMessageService,
    ChatMessageNotificationService,
    InboundMessageRecorderService,
  ],
})
export class ChatModule {}
