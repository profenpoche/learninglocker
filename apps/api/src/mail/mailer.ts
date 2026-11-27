// Envoi des courriels (nodemailer, SMTP). Avec TESTING, aucun envoi : le courriel est seulement journalisé.
// Codes d'origine : legacy/lib/connections/nodemailer.js, legacy/lib/helpers/email.js,
// legacy/lib/templates/emails/*.html (copiés dans apps/api/templates/emails).
import { readFile } from 'node:fs/promises';
import { convert } from 'html-to-text';
import nodemailer, { type Transporter } from 'nodemailer';
import type { ApiConfig } from '../config/config.js';
import type { Logger } from '../core/logger.js';

const TEMPLATES = new URL('../../templates/emails/', import.meta.url);

/** Gabarit lodash `<%= expression %>` : valeurs nommées, plus l'année courante du pied de page. */
export const renderTemplate = (template: string, values: Record<string, unknown>): string =>
  template.replace(/<%=([\s\S]+?)%>/g, (_match, expression: string) => {
    const key = expression.trim();
    if (key === '(new Date()).getFullYear()') return String(new Date().getFullYear());
    const value = values[key];
    return value === null || value === undefined ? '' : (value as string);
  });

interface MailUser {
  name?: unknown;
  email?: unknown;
}

const toFormatter = (user: MailUser): string => `${String(user.name || user.email)} <${String(user.email)}>`;

export class Mailer {
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ApiConfig['mail'], private readonly siteUrl: string | undefined, private readonly logger: Logger) {
    this.from = `${config.fromName} <${config.fromEmail}>`;
    this.transport = config.testing ? null : nodemailer.createTransport({
      host: config.host,
      port: config.port === undefined ? undefined : Number(config.port),
      secure: config.secure,
      ignoreTLS: config.ignoreTLS,
      requireTLS: config.requireTLS,
      ...(config.authRequest ? { auth: { user: config.user, pass: config.pass } } : {}),
    });
  }

  private async send(to: string, subject: string, content: string): Promise<void> {
    if (!this.transport) {
      this.logger.debug(`Pretending to email ${to}`);
      return;
    }
    const wrapper = await readFile(new URL('body.html', TEMPLATES), 'utf8');
    const html = renderTemplate(wrapper, { title: subject, body: content, siteUrl: this.siteUrl });
    try {
      const info: unknown = await this.transport.sendMail({ from: this.from, to, subject, html, text: convert(content) });
      this.logger.debug('Email send attempt', info);
    } catch (error) {
      this.logger.error('Error sending email', error);
    }
  }

  /** sendResetPasswordToken : lien `${SITE_URL}/reset?email=…&token=…`. Envoi non attendu par l'appelant. */
  sendResetPasswordToken(user: MailUser, token: { token: string }): void {
    const subject = 'Request to reset your password';
    const resetLink = `${String(this.siteUrl)}/reset?email=${encodeURIComponent(String(user.email))}&token=${encodeURIComponent(token.token)}`;
    void readFile(new URL('requestPasswordReset.html', TEMPLATES), 'utf8')
      .then((template) => this.send(toFormatter(user), subject, renderTemplate(template, { user: user.name, resetLink })))
      .catch((error: unknown) => { this.logger.error('Error sending email', error); });
  }
}
