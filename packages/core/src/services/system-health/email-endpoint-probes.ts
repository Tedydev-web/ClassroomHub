import { promises as dns } from 'node:dns';
import tls from 'node:tls';

import { EMAIL_FROM, verifySmtpConnection } from '@cio/email';
import { PRODUCT_HOSTS } from '@cio/utils/constants';

import type { HealthProbe, ProbeOutcome } from './types';

/** Certificates renew automatically well before this; reaching it means renewal broke. */
const CERT_WARN_DAYS = 14;
const CERT_FAIL_DAYS = 3;

function senderDomain(): string | null {
  const address = EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? EMAIL_FROM;
  const domain = address.split('@')[1]?.trim().toLowerCase();

  return domain || null;
}

async function readTxt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

async function probeSmtp(): Promise<ProbeOutcome> {
  if ((process.env.ZOHO_TOKEN ?? '').trim()) {
    return { status: 'ok', detail: 'Mail is sent through ZeptoMail (ZOHO_TOKEN); SMTP not used' };
  }
  if (!(process.env.SMTP_HOST ?? '').trim()) return { status: 'unconfigured', detail: 'SMTP_HOST is not set' };

  await verifySmtpConnection();

  return { status: 'ok', detail: `Connected and authenticated to ${process.env.SMTP_HOST}` };
}

/**
 * Accepted by our server is not the same as delivered: without SPF and DMARC the major
 * mailbox providers file this domain's mail as spam or refuse it outright.
 */
async function probeSenderDomain(): Promise<ProbeOutcome> {
  const domain = senderDomain();
  if (!domain) return { status: 'fail', detail: 'Cannot read a domain from the sender address' };

  const [spf, dmarc] = await Promise.all([readTxt(domain), readTxt(`_dmarc.${domain}`)]);
  const hasSpf = spf.some((record) => record.toLowerCase().startsWith('v=spf1'));
  const hasDmarc = dmarc.some((record) => record.toUpperCase().startsWith('V=DMARC1'));

  if (!hasSpf) return { status: 'fail', detail: `${domain}: no SPF record` };
  if (!hasDmarc) return { status: 'warn', detail: `${domain}: SPF present, DMARC missing` };

  return { status: 'ok', detail: `${domain}: SPF and DMARC present` };
}

async function probeModerationInbox(): Promise<ProbeOutcome> {
  const inbox = (process.env.MODERATION_EMAIL ?? '').trim();

  return inbox
    ? { status: 'ok', detail: 'Content reports go to the configured inbox' }
    : { status: 'warn', detail: 'MODERATION_EMAIL is not set; content reports go to the upstream default address' };
}

function readCertificateExpiry(host: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8_000 }, () => {
      const validTo = socket.getPeerCertificate()?.valid_to;
      const authorized = socket.authorized;
      const reason = socket.authorizationError;
      socket.end();

      if (!authorized) return reject(new Error(`Certificate not trusted: ${String(reason)}`));
      if (!validTo) return reject(new Error('No certificate presented'));
      resolve(new Date(validTo));
    });
    socket.on('timeout', () => socket.destroy(new Error('TLS handshake timed out')));
    socket.on('error', reject);
  });
}

function endpointProbe(id: string, label: string, host: string): HealthProbe {
  return {
    id,
    group: 'endpoints',
    label,
    run: async () => {
      const [expiry, response] = await Promise.all([
        readCertificateExpiry(host),
        fetch(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
      ]);
      await response.arrayBuffer().catch(() => undefined);

      const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
      const summary = `HTTP ${response.status}, certificate valid ${daysLeft} more day(s)`;

      if (response.status >= 500) return { status: 'fail', detail: summary };
      if (daysLeft < CERT_FAIL_DAYS) return { status: 'fail', detail: summary };
      if (daysLeft < CERT_WARN_DAYS) return { status: 'warn', detail: summary };

      return { status: 'ok', detail: summary };
    }
  };
}

export function getEmailAndEndpointProbes(): HealthProbe[] {
  return [
    { id: 'smtp', group: 'email', label: 'Outgoing mail server', run: probeSmtp },
    { id: 'sender-domain', group: 'email', label: 'Sender domain SPF / DMARC', run: probeSenderDomain },
    { id: 'moderation-inbox', group: 'email', label: 'Content report inbox', run: probeModerationInbox },
    endpointProbe('endpoint-dashboard', 'Dashboard', PRODUCT_HOSTS.dashboard),
    endpointProbe('endpoint-api', 'API', PRODUCT_HOSTS.api),
    endpointProbe('endpoint-marketing', 'Marketing site', PRODUCT_HOSTS.marketing)
  ];
}
