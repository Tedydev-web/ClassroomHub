import { pathToFileURL } from 'node:url';

import { verifyScannedPdfBenchmarkArtifacts } from './verify-scanned-pdf-benchmark';

function getArtifactPaths(args: string[]) {
  const [manifestPath, firstRunPath, secondRunPath] = args;
  if (manifestPath && firstRunPath && secondRunPath && args.length === 3) {
    return { manifestPath, firstRunPath, secondRunPath };
  }

  throw new Error('Usage: verify-scanned-pdf-benchmark <manifest.json> <first-run.json> <second-run.json>');
}

async function main(): Promise<void> {
  const artifactPaths = getArtifactPaths(process.argv.slice(2));
  const assessment = await verifyScannedPdfBenchmarkArtifacts(artifactPaths);

  console.log(JSON.stringify(assessment, null, 2));
  if (!assessment.ready) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error('verify-scanned-pdf-benchmark error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
