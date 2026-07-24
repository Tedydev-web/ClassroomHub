/**
 * Preflight for an SMTP configuration, before it reaches a running deployment.
 *
 * Answers the three questions a broken mail setup raises, in order, so a failure
 * points at one cause instead of the whole stack:
 *
 *   1. Can we open a TLS session with this host and port?
 *   2. Does the mailbox accept these credentials?
 *   3. Does a real message leave the server?
 *
 * Reads the same `SMTP_*` variables the runtime uses and builds the transport
 * through `createSmtpTransportOptions`, so a pass here means the application
 * will connect the same way — a bespoke transport would prove nothing.
 *
 * Usage:
 *   tsx scripts/verify-smtp-connection.ts                 # connect + authenticate
 *   tsx scripts/verify-smtp-connection.ts you@example.com # also send one message
 *
 * Never prints the password.
 */
import nodemailer from 'nodemailer';

import { createSmtpTransportOptions } from '../src/utils/services/smtp-transport-options';
import { buildEmailFromName, extractNameAndEmail } from '../src/utils/functions/email-helpers';
import { EMAIL_FROM, EMAIL_REPLY_TO } from '../src/utils/constants';

const recipient = process.argv[2];

function fail(stage: string, detail: string): never {
  console.error(`${stage}: FAILED — ${detail}`);
  process.exit(1);
}

let transportOptions: ReturnType<typeof createSmtpTransportOptions>;

try {
  transportOptions = createSmtpTransportOptions(process.env);
} catch (error) {
  fail('CONFIG', error instanceof Error ? error.message : String(error));
}

const sender = extractNameAndEmail(EMAIL_FROM);

if (!sender) {
  fail(
    'CONFIG',
    `SMTP_SENDER is not a usable address: expected '"Name" <user@host>' or 'user@host', got ${JSON.stringify(EMAIL_FROM)}`
  );
}

console.log(
  `CONFIG : ${transportOptions.host}:${transportOptions.port} secure=${transportOptions.secure} auth=${transportOptions.auth ? 'yes' : 'none'}`
);
console.log(`SENDER : ${EMAIL_FROM}`);
console.log(`REPLY  : ${EMAIL_REPLY_TO}`);

const transporter = nodemailer.createTransport(transportOptions);

try {
  await transporter.verify();
  console.log('AUTH   : OK');
} catch (error) {
  fail('AUTH', error instanceof Error ? error.message : String(error));
}

if (!recipient) {
  console.log('SEND   : skipped (pass a recipient address to send a test message)');
  transporter.close();
  process.exit(0);
}

try {
  const info = await transporter.sendMail({
    from: buildEmailFromName('Preflight'),
    to: recipient,
    replyTo: EMAIL_REPLY_TO,
    subject: 'SMTP preflight',
    html: '<p>Sent by <code>verify-smtp-connection</code>. Open the raw source to check the SPF and DKIM verdicts.</p>'
  });

  console.log(`SEND   : OK accepted=${info.accepted.length} rejected=${info.rejected.length}`);
  console.log(`RESP   : ${info.response}`);
  console.log('NEXT   : open the message source at the receiving end and confirm SPF and DKIM both pass');
} catch (error) {
  fail('SEND', error instanceof Error ? error.message : String(error));
}

transporter.close();
