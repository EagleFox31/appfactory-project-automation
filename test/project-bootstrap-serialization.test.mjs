import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const workflow = fs.readFileSync(
  new URL('.github/workflows/reusable-project-automation.yml', root),
  'utf8'
);
const action = fs.readFileSync(new URL('action.yml', root), 'utf8');
const entrypoint = fs.readFileSync(new URL('src/index.mjs', root), 'utf8');

test('public Action exposes explicit bootstrap and sync execution phases', () => {
  assert.match(action, /^  execution-mode:\n    description:/m);
  assert.match(action, /execution-mode:[\s\S]*?default: auto/);
  assert.match(entrypoint, /\['auto', 'bootstrap', 'sync'\]/);
  assert.match(entrypoint, /if \(executionMode === 'bootstrap'\)/);
  assert.match(entrypoint, /if \(executionMode === 'sync'\)/);
});

test('shared bootstrap work is repository-serialized while item concurrency remains scoped', () => {
  const bootstrapGroups = workflow.match(
    /group: project-bootstrap-\$\{\{ github\.repository \}\}/g
  ) ?? [];
  assert.equal(bootstrapGroups.length, 2);

  assert.match(
    workflow,
    /group: project-automation-\$\{\{ github\.repository \}\}-\$\{\{ inputs\.issue_number \|\| github\.event\.issue\.number \|\| github\.event\.pull_request\.number \|\| 'bootstrap' \}\}/
  );
  assert.match(workflow, /execution-mode: bootstrap/);
  assert.match(workflow, /execution-mode: sync/);
  assert.match(workflow, /needs\.bootstrap-token\.result == 'cancelled'/);
  assert.match(workflow, /needs\.bootstrap-github-app-user\.result == 'cancelled'/);
});

test('a 12-Issue burst shares one bootstrap lane without collapsing item lanes', () => {
  const repository = 'Trigenys/example';
  const issueNumbers = Array.from({ length: 12 }, (_, index) => index + 1);
  const bootstrapKeys = issueNumbers.map(() => `project-bootstrap-${repository}`);
  const itemKeys = issueNumbers.map(
    (issueNumber) => `project-automation-${repository}-${issueNumber}`
  );

  assert.equal(new Set(bootstrapKeys).size, 1);
  assert.equal(new Set(itemKeys).size, 12);
});

test('bootstrap completion marker is written only after idempotent backlog import', () => {
  const bootstrapStart = entrypoint.indexOf('async function bootstrapProject');
  const bootstrapEnd = entrypoint.indexOf('function projectBootstrapComplete', bootstrapStart);
  const bootstrapBody = entrypoint.slice(bootstrapStart, bootstrapEnd);

  assert.ok(bootstrapBody.indexOf('importOpenIssues(project, issues)') >= 0);
  assert.ok(bootstrapBody.indexOf('ensureBoardView(project)') >= 0);
  assert.ok(
    bootstrapBody.indexOf('importOpenIssues(project, issues)') <
    bootstrapBody.indexOf('ensureBoardView(project)')
  );
});

test('sync phase never creates Projects and refreshes stale option ids once', () => {
  assert.match(
    entrypoint,
    /resolveProject\(\{[\s\S]*?allowCreate: false,[\s\S]*?waitForExisting: isBootstrapEnabled\(config\)/
  );
  assert.match(
    entrypoint,
    /single select option id does not belong to the field[\s\S]*?fetchProject\(project\.id\)/
  );
  assert.match(entrypoint, /reconcileSchema: false/);
});
