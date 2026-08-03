import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('API process error handling', () => {
  it('does not globally suppress unrelated uncaught process errors', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('registerProcessErrorGuards');
    expect(source).not.toContain("process.on('uncaughtException'");
    expect(source).not.toContain("process.on('unhandledRejection'");
  });
});
