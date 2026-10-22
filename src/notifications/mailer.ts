import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(config: AppConfig, log: Pick<FastifyBaseLogger, 'info'>): Mailer | null {
  if (config.EMAIL_TRANSPORT === 'none') return null;
  if (config.EMAIL_TRANSPORT === 'log') {
    // Development only (config validation requires SMTP in production).
    return { send: async (m) => log.info({ to: m.to, subject: m.subject, text: m.text }, 'email (log transport)') };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL!);
  return {
    send: async (m) => {
      await transport.sendMail({ from: config.EMAIL_FROM, to: m.to, subject: m.subject, text: m.text });
    },
  };
}
