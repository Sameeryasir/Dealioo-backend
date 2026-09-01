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
import { splitAutomationEmailBody } from './automation-email-merge.util';
import { shouldShowPassLinkCta } from './automation-email-cta.util';

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
    const message = props.message?.trim();
    const walletUrl = props.googleWalletSaveUrl?.trim() || '';
    const showPassLink = shouldShowPassLinkCta({
      ctaLabel: props.ctaLabel,
      ctaUrl: props.ctaUrl,
      googleWalletSaveUrl: walletUrl,
    });

    if (props.directBody && message) {
      return splitAutomationEmailBody(message).join('\n\n');
    }

    if (props.directBody) {
      return '';
    }

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

    if (showPassLink && props.ctaUrl) {
      lines.splice(3, 0, `${props.ctaLabel ?? 'Open link'}: ${props.ctaUrl}`);
    }

    if (props.qrImageDataUrl?.trim()) {
      lines.splice(
        showPassLink && props.ctaUrl ? 4 : 3,
        0,
        'Your coupon QR code is included in the HTML version of this email.',
      );
    }

    if (walletUrl) {
      lines.splice(3, 0, `Add to Google Wallet: ${walletUrl}`);
    }

    return lines.join('\n');
  }
}
