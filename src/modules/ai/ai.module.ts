import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelVersion } from '../../db/entities/funnel-version.entity';
import { FunnelPagesModule } from '../funnel-pages/funnel-pages.module';
import { AiController } from './ai.controller';
import { AiOrchestratorService } from './ai.orchestrator.service';
import { AuditService } from './audit/audit.service';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { PromptBuilderService } from './prompt-builder/prompt-builder.service';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { AI_EDIT_UI_QUEUE } from './queue/ai-edit-ui-queue.constants';
import { AiEditUiQueueProcessor } from './queue/ai-edit-ui-queue.processor';
import { AiEditUiQueueService } from './queue/ai-edit-ui-queue.service';
import { AiEditUiRealtimeService } from './queue/ai-edit-ui-realtime.service';
import { SchemaEngineService } from './schema-engine/schema-engine.service';
import { AiValidatorService } from './validator/ai-validator.service';
import { AI_VERSION_STORE } from './version/ai-version-store.interface';
import { TypeOrmAiVersionStore } from './version/typeorm-ai-version.store';
import { VersionService } from './version/version.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Funnel, FunnelVersion]),
    FunnelPagesModule,
    BullModule.registerQueue({ name: AI_EDIT_UI_QUEUE }),
  ],
  controllers: [AiController],
  providers: [
    OpenAiProvider,
    ClaudeProvider,
    GeminiProvider,
    {
      provide: AI_PROVIDER,
      useExisting: GeminiProvider,
    },
    PromptBuilderService,
    AiValidatorService,
    SchemaEngineService,
    TypeOrmAiVersionStore,
    {
      provide: AI_VERSION_STORE,
      useExisting: TypeOrmAiVersionStore,
    },
    VersionService,
    AuditService,
    AiOrchestratorService,
    AiEditUiQueueService,
    AiEditUiRealtimeService,
    AiEditUiQueueProcessor,
  ],
  exports: [
    AiOrchestratorService,
    PromptBuilderService,
    AiValidatorService,
    SchemaEngineService,
    VersionService,
    AuditService,
    OpenAiProvider,
    ClaudeProvider,
    GeminiProvider,
    AI_PROVIDER,
    AiEditUiQueueService,
  ],
})
export class AiModule {}
