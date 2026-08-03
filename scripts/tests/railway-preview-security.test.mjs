import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

function parseYaml(source) {
  const parser = spawnSync(
    'python3',
    ['-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'],
    {
      encoding: 'utf8',
      input: source
    }
  );

  assert.equal(parser.status, 0, parser.stderr);
  return JSON.parse(parser.stdout);
}

async function readWorkflow(filename) {
  const workflowPath = path.resolve('.github/workflows', filename);
  const workflowSource = await readFile(workflowPath, 'utf8');
  return parseYaml(workflowSource);
}

function assertNoGlobalOrJobRailwaySecrets(workflow) {
  assert.equal(workflow['env']?.RAILWAY_API_TOKEN, undefined);
  assert.equal(workflow['env']?.RAILWAY_PROJECT_ID, undefined);

  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['env']?.RAILWAY_API_TOKEN, undefined);
    assert.equal(job['env']?.RAILWAY_PROJECT_ID, undefined);
  }
}

function assertProvenanceGate(workflow, workflowFilename) {
  const provenance = workflow.jobs['verify-provenance'];
  const provenanceRun = provenance.steps[0].run;

  assert.match(provenanceRun, /repos\/\$GITHUB_REPOSITORY/);
  assert.match(provenanceRun, /\.default_branch/);
  assert.match(provenanceRun, /GITHUB_REF/);
  assert.match(provenanceRun, /WORKFLOW_REF/);
  assert.match(provenanceRun, new RegExp(`\\.github/workflows/${workflowFilename.replace('.', '\\.')}`));
}

function assertRailwaySecretsAreProtected(workflow, protectedJobName) {
  const protectedJob = workflow.jobs[protectedJobName];
  const secretSteps = protectedJob.steps.filter((step) => step['env']?.RAILWAY_API_TOKEN);

  assert.equal(protectedJob.environment, 'railway-preview');
  assert.ok(secretSteps.length > 0);
  assert.ok(secretSteps.every((step) => !/\b(?:npm|pnpm|curl|mc)\b/i.test(`${step.name ?? ''}\n${step.run ?? ''}`)));
}

test('Railway preview gates provenance, checks out an immutable branch SHA, and scopes secrets', async () => {
  const workflow = await readWorkflow('railway-preview.yml');
  const preview = workflow.jobs.preview;
  const validation = workflow.jobs['validate-branch'];
  const checkout = preview.steps.find((step) => step.name === 'Checkout target branch');
  const seed = preview.steps.find((step) => step.name === 'Seed the full demo dataset (optional)');
  const validationRun = validation.steps[0].run;

  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assertProvenanceGate(workflow, 'railway-preview.yml');
  assertNoGlobalOrJobRailwaySecrets(workflow);
  assert.deepEqual(preview.needs, ['verify-provenance', 'validate-branch']);
  assert.match(validationRun, /git check-ref-format --branch/);
  assert.match(validationRun, /repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads/);
  assert.match(validationRun, /ref_payload=\$\(curl/);
  assert.match(validationRun, /\.object\.sha/);
  assert.equal(checkout.with.ref, '${{ needs.validate-branch.outputs.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(seed['env']?.RAILWAY_API_TOKEN, undefined);
  assertRailwaySecretsAreProtected(workflow, 'preview');
});

test('Railway teardown gates provenance, validates its branch name, and scopes secrets', async () => {
  const workflow = await readWorkflow('railway-preview-teardown.yml');
  const teardown = workflow.jobs.teardown;
  const validation = workflow.jobs['validate-branch'];
  const deleteStep = teardown.steps.find((step) => step.name === 'Delete the preview environment');

  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assertProvenanceGate(workflow, 'railway-preview-teardown.yml');
  assertNoGlobalOrJobRailwaySecrets(workflow);
  assert.deepEqual(teardown.needs, ['verify-provenance', 'validate-branch']);
  assert.match(validation.steps[0].run, /git check-ref-format --branch/);
  assert.equal(deleteStep['env'].HEAD_REF, '${{ needs.validate-branch.outputs.branch }}');
  assertRailwaySecretsAreProtected(workflow, 'teardown');
});
