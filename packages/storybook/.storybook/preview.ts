import type { Preview } from '@storybook/svelte';

import '../src/index.css';

/**
 * Dark mode, switched by `?dark=1` on the preview URL.
 *
 * The design system applies dark mode with a `.dark` class rather than a media query, so a
 * screenshot tool cannot reach it by emulating `prefers-color-scheme`. A URL flag can, which
 * makes every story checkable in both themes by a headless browser — the half of visual review
 * that needs neither a running app nor a session.
 */
if (typeof document !== 'undefined') {
  const wantsDark = new URLSearchParams(window.location.search).get('dark') === '1';
  document.documentElement.classList.toggle('dark', wantsDark);
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    }
  }
};

export default preview;
