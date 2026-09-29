import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  diffHealthReports: vi.fn(),
  readScheduledHealthReport: vi.fn(),
  runSystemHealthChecks: vi.fn(),
  saveScheduledHealthReport: vi.fn(),
  sendHealthAlertEmail: vi.fn()
}));

vi.mock('@cio/core/services/system-health/index', () => mocks);
vi.mock('../../utils/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { scanSystemHealth } from './scan-system-health';

const failingCheck = { id: 'smtp', group: 'email', label: 'SMTP', status: 'fail', detail: 'auth', latencyMs: 1 };
const report = { status: 'fail', source: 'jobs', checkedAt: 'now', durationMs: 1, checks: [failingCheck] };

describe('scheduled system health scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readScheduledHealthReport.mockResolvedValue(null);
    mocks.runSystemHealthChecks.mockResolvedValue(report);
  });

  it('keeps the report unsaved when the alert it owes is not delivered, so the next scan retries', async () => {
    mocks.diffHealthReports.mockReturnValue({ newlyFailing: [failingCheck], recovered: [] });
    mocks.sendHealthAlertEmail.mockResolvedValue({ accepted: false, detail: 'SMTP down' });

    const result = await scanSystemHealth();

    expect(result.alerted).toBe(false);
    expect(mocks.saveScheduledHealthReport).not.toHaveBeenCalled();
  });

  it('saves the report after the alert is accepted', async () => {
    mocks.diffHealthReports.mockReturnValue({ newlyFailing: [failingCheck], recovered: [] });
    mocks.sendHealthAlertEmail.mockResolvedValue({ accepted: true, detail: '250 queued' });

    const result = await scanSystemHealth();

    expect(result.alerted).toBe(true);
    expect(mocks.saveScheduledHealthReport).toHaveBeenCalledWith(report);
  });

  it('sends nothing when no check changed state', async () => {
    mocks.diffHealthReports.mockReturnValue({ newlyFailing: [], recovered: [] });

    await scanSystemHealth();

    expect(mocks.sendHealthAlertEmail).not.toHaveBeenCalled();
    expect(mocks.saveScheduledHealthReport).toHaveBeenCalledWith(report);
  });
});
