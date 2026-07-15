import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function encryptionKey(secret: string): Buffer {
  if (!secret) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY is not configured');
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptWebhookSecret(value: string, secret: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), initializationVector);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return [initializationVector, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptWebhookSecret(value: string, secret: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted webhook secret');
  }

  const [initializationVector, authTag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), initializationVector!);
  decipher.setAuthTag(authTag!);

  return Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString('utf8');
}

export function signWebhookPayload(timestamp: number, body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function isPrivateAddress(address: string): boolean {
  const normalizedAddress = address.toLowerCase();
  if (
    normalizedAddress === '::1' ||
    normalizedAddress === '0:0:0:0:0:0:0:1' ||
    normalizedAddress.startsWith('fc') ||
    normalizedAddress.startsWith('fd') ||
    normalizedAddress.startsWith('fe8') ||
    normalizedAddress.startsWith('fe9') ||
    normalizedAddress.startsWith('fea') ||
    normalizedAddress.startsWith('feb') ||
    normalizedAddress.startsWith('ff')
  ) {
    return true;
  }

  const mappedIpv4 = normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) {
    return isPrivateAddress(mappedIpv4);
  }

  if (!isIP(normalizedAddress) || normalizedAddress.includes(':')) {
    return false;
  }

  const [first, second] = normalizedAddress.split('.').map(Number);

  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}

export async function assertWebhookUrl(rawUrl: string, allowPrivateNetworks: boolean): Promise<URL> {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Webhook URL must use HTTP or HTTPS');
  }
  if (!allowPrivateNetworks && url.protocol !== 'https:') {
    throw new Error('Cloud webhooks require HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain credentials');
  }

  const normalizedHost = url.hostname.toLowerCase();
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost')) {
    if (!allowPrivateNetworks) {
      throw new Error('Private webhook targets are not allowed');
    }

    return url;
  }

  const addresses = await lookup(normalizedHost, { all: true, verbatim: true });
  if (!allowPrivateNetworks && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private webhook targets are not allowed');
  }

  return url;
}
