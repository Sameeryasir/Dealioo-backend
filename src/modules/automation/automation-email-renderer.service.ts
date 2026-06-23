import { Injectable } from '@nestjs/common';
import { render } from '@react-email/render';
import * as React from 'react';
import {
  getAutomationEmailComponent,
  resolveAutomationEmailTemplateId,
} from '../../templates/automation/registry';
import type {
  AutomationEmailRenderResult,
  AutomationEmailTemplateProps,
} from '../../templates/automation/types';

@Injectable()
export class AutomationEmailRendererService {
  async render(
    templateKey: string,
    props: AutomationEmailTemplateProps,
  ): Promise<AutomationEmailRenderResult> {
    const templateId = resolveAutomationEmailTemplateId(templateKey);
    const Component = getAutomationEmailComponent(templateId);
    const html = await render(React.createElement(Component, props));
    const text = this.buildPlainText(props);

    return { html, text };
  }

  private buildPlainText(props: AutomationEmailTemplateProps): string {
    const name = props.customerName?.trim() || 'there';
    const title = props.headline?.trim() || props.subject?.trim();
    const lines = [
      title ? `${title}` : '',
      title ? '' : null,
      `Hi ${name},`,
      '',
      props.message?.trim() ||
        'Please check your account for an important update from Dealioo.',
      '',
      'Best regards,',
      'Dealioo Team',
    ].filter((line): line is string => line !== null);

    if (props.ctaUrl) {
      lines.splice(3, 0, `${props.ctaLabel ?? 'Open link'}: ${props.ctaUrl}`);
    }

    return lines.join('\n');
  }
}
