import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * The password on an exam link.
 *
 * This is one secret shared by a whole room for one sitting, not a personal credential:
 * it is handed out loud, used within the hour, and thrown away. `scrypt` from the standard
 * library is the right weight for that, and it keeps the exam feature free of a hashing
 * dependency the API does not otherwise carry.
 *
 * The stored form names its own algorithm and parameters so a later change can re-hash
 * rather than guess what the existing values were made with.
 */

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashExamPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Compares in constant time. A comparison that returns as soon as two bytes differ tells
 * anybody who can time it how much of their guess was right.
 */
export async function verifyExamPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
