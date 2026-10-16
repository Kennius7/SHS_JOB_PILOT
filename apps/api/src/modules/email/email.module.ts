import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createEmailSender, EmailProvider } from '@shs/email';
import { EMAIL_SENDER } from './email.constants';
import { MailerService } from './email.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = (config.get<string>('EMAIL_PROVIDER', 'console') ||
          'console') as EmailProvider;
        return createEmailSender({
          provider,
          from: config.get<string>('EMAIL_FROM', 'SHS Job Pilot <no-reply@localhost>'),
          smtp: {
            host: config.get<string>('SMTP_HOST'),
            port: Number(config.get('SMTP_PORT', 587)),
            secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          },
        });
      },
    },
    MailerService,
  ],
  exports: [EMAIL_SENDER, MailerService],
})
export class EmailModule {}
