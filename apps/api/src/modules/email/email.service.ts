import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMessage, EmailSender } from '@shs/email';
import { EMAIL_SENDER } from './email.constants';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  private link(path: string, token: string): string {
    const base = this.config.get<string>('WEB_URL', 'http://localhost:3000');
    return `${base.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;
  }

  async sendVerification(to: string, token: string): Promise<void> {
    const link = this.link('/verify-email', token);
    await this.safeSend({
      to,
      subject: 'Verify your SHS Job Pilot email',
      text: `Welcome to SHS Job Pilot!\n\nConfirm your email address:\n${link}\n\nThis link expires in 24 hours.`,
      html: `<p>Welcome to <strong>SHS Job Pilot</strong>!</p><p>Confirm your email address:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = this.link('/reset-password', token);
    await this.safeSend({
      to,
      subject: 'Reset your SHS Job Pilot password',
      text: `We received a request to reset your password.\n\nReset it here:\n${link}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`,
    });
  }

  private async safeSend(message: EmailMessage): Promise<void> {
    try {
      await this.sender.send(message);
    } catch (e) {
      this.logger.error(
        `Failed to send email via "${this.sender.name}": ${(e as Error).message}`,
      );
    }
  }
}
