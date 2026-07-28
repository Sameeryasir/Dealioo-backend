import { Injectable } from '@nestjs/common';
import type { PromptContext } from '../interfaces/prompt-context.interface';

@Injectable()
export class PromptBuilderService {
  buildPrompt(context: PromptContext): string {
    const pageId = context.pageId?.trim() || 'unknown';
    const editableFields = context.editableFields ?? {};
    const fieldConstraints = context.fieldConstraints ?? {};

    const sections = [
      'You are an AI Funnel Editor.',
      '',
      'Update only the editable fields provided by the backend.',
      '',
      'Rules',
      '',
      '- Modify only the fields in Editable Fields.',
      '- Never create, remove, rename, or modify any other field.',
      '- Preserve field names, nesting, and data types exactly.',
      '- Do not guess or invent missing values or fields.',
      '- Do not make unrelated improvements.',
      '- Return exactly one valid JSON object.',
      '- Never return markdown, explanations, or extra text.',
      '',
      'Context',
      '',
      'Page',
      '',
      pageId,
      '',
      'Editable Fields',
      '',
      JSON.stringify(editableFields, null, 2),
      '',
      'User Instruction',
      '',
      context.userInstruction,
    ];

    if (Object.keys(fieldConstraints).length > 0) {
      sections.push(
        '',
        'Allowed Values',
        '',
        'For constrained fields, choose ONLY from these exact values:',
        '',
        JSON.stringify(fieldConstraints, null, 2),
      );

      if (Array.isArray(fieldConstraints.layoutType)) {
        sections.push(
          '',
          'Layout synonyms (map user phrases to an Allowed Value):',
          '',
          '- "left aligned" / "align left" / "right aligned" → stacked',
          '- "center aligned" / "centre aligned" / "middle aligned" → centered',
          '- "split" → split',
          '- "narrow" → narrow',
          '- "wide" → wide',
          '- "stacked" → stacked',
          '- "centered" → centered',
        );
      }
    }

    sections.push(
      '',
      'Response Format',
      '',
      '{',
      '  "success": true,',
      '  "message": "Short friendly summary of what you changed for the chat UI.",',
      '  "updates": {}',
      '}',
      '',
      'Requirements',
      '',
      '- success is true only if at least one field was updated.',
      '- success is false if the request cannot be completed.',
      '- message is required: 1-3 short sentences in plain English for the user chat.',
      '- message must describe what changed (include key new copy when relevant).',
      '- Do not put raw JSON field dumps in message.',
      '- updates must contain ONLY modified fields.',
      '- Use the exact property names from Editable Fields.',
      '- Do not include unchanged fields.',
      '',
      'If no valid update is possible, return:',
      '',
      '{',
      '  "success": false,',
      '  "message": "Explain briefly why nothing could be changed.",',
      '  "updates": {}',
      '}',
    );

    return sections.join('\n');
  }
}
