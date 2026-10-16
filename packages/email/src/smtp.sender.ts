import { createTransport, Transporter } from 'nodemailer';
import { EmailConfig, EmailMessage, EmailSender } from './types';

export class SmtpEmailSender implements EmailSender {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(private readonly config: EmailConfig) {
    if (!config.smtp.host) throw new Error('SMTP host is required');
    this.transporter = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
