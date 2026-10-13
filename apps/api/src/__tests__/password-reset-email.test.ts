import { beforeEach, describe, expect, it, vi } from 'vitest';

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock('@cio/email', () => ({ sendEmail: vi.fn() }));
vi.mock('@cio/jobs', () => ({ enqueueEmailSend: vi.fn() }));
vi.mock('@db/drizzle', () => ({
  eq: vi.fn(),
  db: { select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) }
}));

import { config } from '../../../../packages/db/src/auth/email-password';
import { enqueueEmailSend } from '@cio/jobs';
import { sendEmail } from '@cio/email';

const user = { id: 'user-1', email: 'teacher@example.com' };

describe('password reset emails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([{ fullname: 'Ada Lovelace' }]);
  });

  it('queues the reset link email for retry instead of sending inline', async () => {
    const url = 'https://app.example.com/reset-password/token-1';

    await config!.sendResetPassword!({ user, url, token: 'token-1' } as never);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(enqueueEmailSend).toHaveBeenCalledWith({
      kind: 'template',
      template: 'forgotPassword',
      to: user.email,
      fields: { name: 'Ada Lovelace', email: user.email, link: url }
    });
  });

  it('queues the password changed notice', async () => {
    await config!.onPasswordReset!({ user } as never);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(enqueueEmailSend).toHaveBeenCalledWith({
      kind: 'template',
      template: 'onPasswordReset',
      to: user.email,
      fields: { name: 'Ada Lovelace' }
    });
  });
});
