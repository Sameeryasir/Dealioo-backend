import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiOrchestratorService } from './ai.orchestrator.service';
import { AuditService } from './audit/audit.service';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { PromptBuilderService } from './prompt-builder/prompt-builder.service';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { SchemaEngineService } from './schema-engine/schema-engine.service';
import { AiValidatorService } from './validator/ai-validator.service';
import { AI_VERSION_STORE } from './version/ai-version-store.interface';
import { NoopAiVersionStore } from './version/noop-ai-version.store';
import { VersionService } from './version/version.service';

@Module({
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
    NoopAiVersionStore,
    {
      provide: AI_VERSION_STORE,
      useExisting: NoopAiVersionStore,
    },
    VersionService,
    AuditService,
    AiOrchestratorService,
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
  ],
})
export class AiModule {}
