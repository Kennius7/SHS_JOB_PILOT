export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export type EmailProvider = 'console' | 'memory' | 'smtp' | 'none';

export interface EmailConfig {
  provider: EmailProvider;
  from: string;
  smtp: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
  };
}
