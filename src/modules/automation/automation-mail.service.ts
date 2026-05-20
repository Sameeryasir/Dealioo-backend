import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

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

    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? params.html.replace(/<[^>]+>/g, ' ').trim(),
    });

    this.logger.log(`Automation email sent to ${params.to}`);
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
    });

    return this.transporter;
  }
}
