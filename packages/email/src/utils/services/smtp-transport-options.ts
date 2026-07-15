import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export type SmtpEnvironment = {
  SMTP_HOST?: string;
  SMTP_PASSWORD?: string;
  SMTP_PORT?: string;
  SMTP_REQUIRE_TLS?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
};

export function parseSmtpBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;

  throw new Error(`${name} must be "true" or "false"`);
}

export function parseSmtpPort(value: string | undefined): number {
  const port = Number(value ?? '465');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SMTP_PORT must be an integer from 1 to 65535');

  return port;
}

export function createSmtpTransportOptions(environment: SmtpEnvironment): SMTPTransport.Options {
  if (!environment.SMTP_HOST) throw new Error('SMTP_HOST is required');

  const port = parseSmtpPort(environment.SMTP_PORT);
  const secure = parseSmtpBoolean('SMTP_SECURE', environment.SMTP_SECURE, port === 465);
  const requireTLS = parseSmtpBoolean('SMTP_REQUIRE_TLS', environment.SMTP_REQUIRE_TLS, !secure);
  const hasUser = Boolean(environment.SMTP_USER);
  const hasPassword = Boolean(environment.SMTP_PASSWORD);

  if (hasUser !== hasPassword) throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
  if (!hasUser && !(environment.SMTP_SECURE === 'false' && environment.SMTP_REQUIRE_TLS === 'false')) {
    throw new Error('Authless SMTP requires explicit SMTP_SECURE=false and SMTP_REQUIRE_TLS=false');
  }

  return {
    host: environment.SMTP_HOST,
    port,
    secure,
    requireTLS,
    ...(hasUser ? { auth: { user: environment.SMTP_USER!, pass: environment.SMTP_PASSWORD! } } : {})
  };
}
