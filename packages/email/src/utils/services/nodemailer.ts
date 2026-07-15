import { EmailResponse } from '../types';
import type { TEmailData } from '@cio/utils/validation/mail';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { EMAIL_FROM } from '../constants';
import nodemailer from 'nodemailer';
import { createSmtpTransportOptions } from './smtp-transport-options';

let transporter: Transporter | undefined;

const setupTransporter = async () => {
  if (!env.SMTP_HOST) {
    console.error('SMTP configuration missing');
    return undefined;
  }

  try {
    const transportOptions = createSmtpTransportOptions(env);
    transporter = nodemailer.createTransport(transportOptions);

    await transporter.verify();

    return transporter;
  } catch (error) {
    console.error('Transporter error:', error);
    return undefined;
  }
};

export async function sendWithNodemailer(emailData: TEmailData): Promise<EmailResponse> {
  const { from, to, subject, content, replyTo, ics } = emailData;

  if (!transporter) {
    transporter = await setupTransporter();
  }

  if (!transporter) {
    return {
      success: false,
      error: 'Email transporter not initialized'
    };
  }

  try {
    const result = await transporter.sendMail({
      from: from ?? EMAIL_FROM,
      to,
      subject,
      replyTo,
      html: content,
      ...(ics ? { icalEvent: { filename: 'session.ics', method: 'PUBLISH', content: ics } } : {})
    });

    return {
      success: true,
      details: result
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      details: error
    };
  }
}
