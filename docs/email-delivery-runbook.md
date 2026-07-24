# Email delivery runbook

How mail leaves this system, how to configure a sending domain, and how to tell where a
missing email actually went. For the template API, see `packages/email/README.md`.

## The path a message takes

```
domain handler  →  enqueueTransactionalEmail()  →  BullMQ "emails" queue
                                                            ↓
                                                   @cio/jobs-worker
                                                            ↓
                                          ZOHO_TOKEN set?  →  ZeptoMail
                                                    else  →  SMTP (nodemailer)
```

Two consequences worth knowing before debugging:

- **Nothing sends without the worker.** `apps/api` only enqueues. If `@cio/jobs-worker` is not
  running, mail sits in Redis and no error surfaces to the user.
- **No Redis means no mail, silently.** `enqueueTransactionalEmail` logs once and returns
  `{ jobIds: [] }` when `REDIS_URL` is unset. This is deliberate — a missing queue must not break
  the request — but it looks identical to "sent" from the caller's side.

## "I sent an invite and received nothing"

Work down this list; each step rules out one layer.

1. **Is it in the dev catcher?** Local development points at Mailpit, which accepts every message
   and forwards none. Read it at <http://127.0.0.1:8007>. Mail found here was sent correctly.
2. **Is the job queued?** `docker exec <redis> redis-cli --scan --pattern 'bull:emails:*'`.
   A job in `completed` left the process; a job in `failed` carries the error in its hash.
3. **Is the worker alive?** Look for `src/workers/emails.ts` in the process list.
4. **Did the provider accept it?** Run the preflight below against the same configuration.
5. **Did the recipient's provider accept it?** Open the raw source at the receiving end and read
   the SPF and DKIM verdicts. Authentication failures are usually invisible to the sender.

## Preflight

```bash
pnpm --filter @cio/email verify:smtp                    # connect + authenticate
pnpm --filter @cio/email verify:smtp you@example.com    # also send one message
```

It reads the same `SMTP_*` variables the runtime uses and builds the transport through
`createSmtpTransportOptions`, so a pass means the application connects the same way. Run it
against a new environment before trusting it with real invitations.

## Addresses

Three roles, three places to change them. They are separate on purpose.

| Role | Value | Configured in |
| --- | --- | --- |
| Envelope sender (`From`) | per environment | `SMTP_SENDER` |
| Support (`Reply-To`, and printed in template bodies) | `OPERATOR_EMAIL` | `packages/utils/src/constants/product-identity.ts` |
| Sales (marketing-site `mailto:` links) | `SALES_EMAIL` | same file |

`SALES_EMAIL` currently aliases `OPERATOR_EMAIL` because the mail plan allows one mailbox. It
stays a distinct constant so pointing it at a real `sales@` later is a one-line change rather than
an audit of every link.

`OPERATOR_EMAIL` is not only a header — `forgot-password` and `welcome` print it in the body. It
must be a mailbox somebody reads, and it must sit on the product domain: a consumer address on an
invitation reads as phishing, and consumer providers cannot DKIM-sign for this domain.

### `SMTP_SENDER` must be a full RFC 5322 address

```bash
SMTP_SENDER='"ClassroomHub" <support@classroom.io.vn>'   # preferred
SMTP_SENDER='support@classroom.io.vn'                    # also accepted
```

A display name without quotes used to produce a nested header —
`"Org (via ClassroomHub)" <ClassroomHub <noreply@host>>` — which Mailpit tolerates and real
providers reject. `extractNameAndEmail` now parses all three forms and returns `undefined` rather
than guessing, so a malformed value falls back to the configured sender instead of shipping a
broken header. Regression tests live in `packages/email/tests/email-helpers.test.ts`.

## Configuring a sending domain

Publish SPF and DKIM before sending anything real; a domain that starts out unauthenticated earns
a reputation that is slow to undo.

1. Create the mailbox at the provider. A domain-admin or control-panel login is usually **not** a
   mailbox — SMTP `AUTH` against it fails with `535` even when the password is correct.
2. Publish the provider's DNS records. Three recurring mistakes:
   - The mail host's `A` record must be **DNS-only** behind Cloudflare. Proxying it breaks SMTP.
   - **One** SPF record per domain. Two `v=spf1` records invalidate both — merge instead.
   - A DKIM value split across lines in a panel is still **one** TXT record. Long values are split
     into multiple strings by DNS itself; that is normal.
3. Verify propagation:

   ```bash
   dig +short <domain> MX @8.8.8.8
   dig +short <mail-host> A @8.8.8.8
   dig +short <domain> TXT @8.8.8.8 | grep spf
   dig +short <selector>._domainkey.<domain> TXT @8.8.8.8
   ```

4. Set the `SMTP_*` variables in the deployment environment, then run the preflight.

### Reading a refusal

| Symptom | Means |
| --- | --- |
| `535 authentication failed` | Server reachable, credential rejected. Wrong password, or the account is not a mailbox. |
| TLS handshake alert, but `openssl -tls1_2` works | `openssl`'s default negotiation, not a server fault. Node connects fine. |
| Port open, no banner, connection closes | That port is not serving SMTP. Use the one that answers `220`. |
| Port 25 times out | Normally the local network blocking outbound SMTP. Use 465 or 587. |

Probe a server directly with:

```bash
openssl s_client -tls1_2 -connect <host>:465 -servername <host> -quiet
# then type: EHLO example.com
```

The `EHLO` response lists the `AUTH` mechanisms and the size limit the server will enforce.
