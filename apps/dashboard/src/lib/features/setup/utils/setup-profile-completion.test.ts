import { describe, expect, it } from 'vitest';
import type { SetupItem } from '../api/setup-progress.svelte';
import { withProfileCompletion } from './setup-profile-completion';

const item = (id: string, is_completed: boolean): SetupItem => ({
  id,
  title: id,
  desc: id,
  is_completed,
  button_label: id
});

describe('withProfileCompletion', () => {
  it('marks the profile step done when the profile has an avatar', () => {
    const [profileStep] = withProfileCompletion([item('profile', false)], 'https://cdn.example/me.png');
    expect(profileStep.is_completed).toBe(true);
  });

  it('leaves every other step exactly as the server reported it', () => {
    const items = withProfileCompletion([item('profile', false), item('course', false)], 'https://cdn.example/me.png');
    expect(items[1].is_completed).toBe(false);
  });
});
