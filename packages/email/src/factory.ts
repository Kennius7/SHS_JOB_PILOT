import { ConsoleEmailSender } from './console.sender';
import { MemoryEmailSender } from './memory.sender';
import { NoopEmailSender } from './noop.sender';
import { SmtpEmailSender } from './smtp.sender';
import { EmailConfig, EmailSender } from './types';

export function createEmailSender(config: EmailConfig): EmailSender {
  switch (config.provider) {
    case 'smtp':
      return new SmtpEmailSender(config);
    case 'memory':
      return new MemoryEmailSender();
    case 'none':
      return new NoopEmailSender();
    case 'console':
    default:
      return new ConsoleEmailSender();
  }
}
