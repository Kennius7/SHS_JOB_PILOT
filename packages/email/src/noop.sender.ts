import { EmailMessage, EmailSender } from './types';

export class NoopEmailSender implements EmailSender {
  readonly name = 'none';

  async send(_message: EmailMessage): Promise<void> {
    return;
  }
}
