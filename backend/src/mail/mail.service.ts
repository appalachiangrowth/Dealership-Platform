import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';

export interface SendResult {
  sent: boolean;
  error?: string;
  from?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: 'ssl' | 'tls' | 'none';
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

/**
 * E-mail for inquiries, replies and test messages.
 * Uses the dealership's own SMTP server when it has one, otherwise the platform mail server
 * (Platform Admin > Platform settings > Mail server).
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  constructor(private readonly prisma: PrismaService, private readonly platform: PlatformSettingsService) {}

  private async config(tenantId?: string): Promise<SmtpConfig | null> {
    if (tenantId) {
      const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
      if (s && s.smtpHost && s.smtpUser && s.smtpPass) {
        return {
          host: s.smtpHost,
          port: s.smtpPort,
          secure: s.smtpSecure.toLowerCase() as SmtpConfig['secure'],
          user: s.smtpUser,
          pass: s.smtpPass,
          from: s.smtpFrom || s.smtpUser,
          fromName: s.smtpFromName || s.name,
        };
      }
    }
    const p = (await this.platform.all()).smtp as Record<string, unknown>;
    if (!p.host || !p.user || !p.pass) return null;
    let fromName = String(p.fromName || '');
    if (tenantId) {
      const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { name: true } });
      if (s?.name) fromName = s.name;
    }
    return {
      host: String(p.host),
      port: Number(p.port) || 465,
      secure: (String(p.secure || 'ssl') as SmtpConfig['secure']),
      user: String(p.user),
      pass: String(p.pass),
      from: String(p.from || p.user),
      fromName,
    };
  }

  async send(opts: { tenantId?: string; to: string; subject: string; text: string; replyTo?: string }): Promise<SendResult> {
    const cfg = await this.config(opts.tenantId);
    if (!cfg) return { sent: false, error: 'No mail server is set up yet (Platform settings > Mail server).' };
    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure === 'ssl',
        requireTLS: cfg.secure === 'tls',
        auth: { user: cfg.user, pass: cfg.pass },
        connectionTimeout: 15_000,
      });
      await transport.sendMail({
        from: cfg.fromName ? { name: cfg.fromName, address: cfg.from } : cfg.from,
        to: opts.to,
        subject: opts.subject.slice(0, 250),
        text: opts.text,
        replyTo: opts.replyTo || undefined,
      });
      return { sent: true, from: cfg.from };
    } catch (e) {
      const msg = (e as Error).message;
      this.log.warn(`send failed: ${msg}`);
      return { sent: false, error: msg, from: cfg.from };
    }
  }
}
