import { EmailMessage, EmailSender } from './types';

export class ConsoleEmailSender implements EmailSender {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    const body = message.text.replace(/\n/g, '\n    ');
    console.log(
      `\n[email:console] to=${message.to}\n    subject="${message.subject}"\n    ${body}\n`,
    );
  }
}
