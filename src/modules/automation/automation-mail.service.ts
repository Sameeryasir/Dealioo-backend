import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AutomationMailService {
  private readonly logger = new Logger(AutomationMailService.name);

  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    const mailUser = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;
    if (!mailUser?.trim() || !pass?.trim()) {
      throw new Error(
        'MAIL_USER and MAIL_PASS must be set to send automation emails.',
      );
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: mailUser, pass },
    });

    const from = process.env.MAIL_FROM?.trim() || mailUser;

    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? params.html.replace(/<[^>]+>/g, ' ').trim(),
    });

    this.logger.log(`Automation email sent to ${params.to}`);
  }
}
