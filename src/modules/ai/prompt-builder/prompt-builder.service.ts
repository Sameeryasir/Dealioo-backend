import { Injectable } from '@nestjs/common';
import type { PromptContext } from '../interfaces/prompt-context.interface';

@Injectable()
export class PromptBuilderService {
  buildPrompt(context: PromptContext): string {
    const sections = [
      this.buildSystemRoleSection(),
      this.buildFunnelContextSection(context),
      this.buildCurrentSchemaSection(context.currentSchema),
      this.buildUserInstructionSection(context.userInstruction),
      this.buildOutputRulesSection(),
    ];

    return sections.join('\n\n');
  }

  private buildSystemRoleSection(): string {
    return [
      '## System role',
      'You are an expert UI Funnel Editor.',
      'You may modify only the supplied funnel schema.',
      'You must never invent missing data.',
      'You must return JSON only.',
    ].join('\n');
  }

  private buildFunnelContextSection(context: PromptContext): string {
    const lines = [
      '## Funnel context',
      `businessId: ${context.businessId}`,
    ];

    if (context.campaignId != null) {
      lines.push(`campaignId: ${context.campaignId}`);
    }
    if (context.funnelId != null) {
      lines.push(`funnelId: ${context.funnelId}`);
    }
    if (context.pageId != null && context.pageId !== '') {
      lines.push(`pageId: ${context.pageId}`);
    }

    return lines.join('\n');
  }

  private buildCurrentSchemaSection(
    currentSchema: PromptContext['currentSchema'],
  ): string {
    const header = '## Current schema';

    if (currentSchema == null) {
      return `${header}\nNo current schema exists.`;
    }

    return `${header}\n${JSON.stringify(currentSchema, null, 2)}`;
  }

  private buildUserInstructionSection(userInstruction: string): string {
    return ['## User instruction', userInstruction].join('\n');
  }

  private buildOutputRulesSection(): string {
    return [
      '## Output rules',
      'Return valid JSON only.',
      'No markdown.',
      'No explanations.',
      'No code fences.',
    ].join('\n');
  }
}
