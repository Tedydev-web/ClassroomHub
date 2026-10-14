import { describe, expect, it } from 'vitest';

import { DEFAULT_PICKER_MODEL_ID } from '@cio/utils/agent-models';
import { resolveStudentTutorModelId } from '@api/services/agent/picker-status';

describe('resolveStudentTutorModelId', () => {
  it('uses the gateway light model for learners', () => {
    expect(
      resolveStudentTutorModelId({ lightModelId: 'claude-haiku-4-5-20251001', defaultModelId: 'claude-sonnet-5' })
    ).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to the gateway default model when no light model is set', () => {
    expect(resolveStudentTutorModelId({ lightModelId: null, defaultModelId: 'claude-sonnet-5' })).toBe(
      'claude-sonnet-5'
    );
  });

  it('skips a configured model the registry does not know', () => {
    expect(resolveStudentTutorModelId({ lightModelId: 'retired-model', defaultModelId: 'claude-sonnet-5' })).toBe(
      'claude-sonnet-5'
    );
  });

  it('falls back to the registry default when the gateway names no usable model', () => {
    expect(resolveStudentTutorModelId({ lightModelId: null, defaultModelId: null })).toBe(DEFAULT_PICKER_MODEL_ID);
  });
});
