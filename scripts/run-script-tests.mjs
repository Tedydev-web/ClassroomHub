import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function runScriptTests() {
  const testsDirectory = path.resolve('scripts/tests');
  const entries = await readdir(testsDirectory, { withFileTypes: true });
  const testFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => path.join(testsDirectory, entry.name))
    .sort();

  if (testFiles.length === 0) {
    throw new Error('No script tests found in scripts/tests.');
  }

  const child = spawn(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit',
    windowsHide: true
  });

  child.once('error', (error) => {
    console.error(`Failed to start script tests: ${error.message}`);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`Script tests terminated by signal ${signal}.`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code ?? 1;
  });
}

runScriptTests().catch((error) => {
  console.error(`Failed to discover script tests: ${error.message}`);
  process.exitCode = 1;
});
