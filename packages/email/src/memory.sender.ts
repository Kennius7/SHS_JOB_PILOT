import { EmailMessage, EmailSender } from './types';

export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory';
  static messages: EmailMessage[] = [];

  static clear(): void {
    MemoryEmailSender.messages = [];
  }

  static last(): EmailMessage | undefined {
    return MemoryEmailSender.messages[MemoryEmailSender.messages.length - 1];
  }

  async send(message: EmailMessage): Promise<void> {
    MemoryEmailSender.messages.push(message);
  }
}
