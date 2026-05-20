import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

const DEFAULT_MAIL_SEND_MS = 20_000;

@Injectable()
export class AutomationMailService {
  private readonly logger = new Logger(AutomationMailService.name);
  private transporter: nodemailer.Transporter | null = null;

  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    const transporter = this.getTransporter();
    const from =
      process.env.MAIL_FROM?.trim() || process.env.MAIL_USER?.trim() || '';
    const timeoutMs = this.resolveSendTimeoutMs();

    const sendPromise = transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? params.html.replace(/<[^>]+>/g, ' ').trim(),
    });

    await this.withTimeout(
      sendPromise,
      timeoutMs,
      `Email send timed out after ${timeoutMs}ms (check MAIL_USER/MAIL_PASS and SMTP connectivity)`,
    );

    this.logger.log(`Automation email sent to ${params.to}`);
  }

  private resolveSendTimeoutMs(): number {
    const raw = process.env.MAIL_SEND_TIMEOUT_MS?.trim();
    if (!raw) {
      return DEFAULT_MAIL_SEND_MS;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_MAIL_SEND_MS;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const mailUser = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;
    if (!mailUser?.trim() || !pass?.trim()) {
      throw new Error(
        'MAIL_USER and MAIL_PASS must be set to send automation emails.',
      );
    }

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: mailUser, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    return this.transporter;
  }
}
