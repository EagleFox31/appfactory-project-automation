import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bootstrapFieldDefinitions, issueMetadata, validateConfig } from '../src/lib.mjs';

const configPath = new URL('../.github/project-config.json', import.meta.url);
const workflowPath = new URL('../.github/workflows/project-automation.yml', import.meta.url);

test('AppFactory dogfoods Project automation with a valid self-owned backlog', () => {
  const config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  assert.equal(config.project.owner, 'EagleFox31');
  assert.equal(config.project.title, 'AppFactory Project Automation');
  assert.equal(config.project.template, 'appfactory-product');
  assert.equal(config.project.bootstrap, true);
  assert.equal(config.project.linkRepository, true);
  assert.equal(config.project.importOpenIssues, true);
  assert.equal(config.project.createBoardView, true);
  assert.equal(config.bootstrap.boardViewName, 'AppFactory Board');
  assert.ok(config.bootstrap.phases.includes('Foundation'));

  const openIssue = {
    number: 75,
    title: '[CI/CD] Reusable Docker Compose deployment',
    body: '<!-- appfactory-project\\npriority: P1\\nworkType: Feature\\nphase: Foundation\\nsize: L\\n-->'
  };
  const metadata = issueMetadata(openIssue, config);
  assert.deepEqual(metadata, {
    priority: 'P1',
    workType: 'Feature',
    phase: 'Foundation',
    size: 'L'
  });
  const fields = bootstrapFieldDefinitions(config, [openIssue]);
  assert.deepEqual(fields.map((field) => field.name), [
    'Status', 'Priority', 'Work type', 'Phase', 'Size'
  ]);
  const status = fields.find((field) => field.name === 'Status');
  for (const value of ['Backlog', 'Ready', 'In Progress', 'Review', 'Validation', 'Done']) {
    assert.ok(status.options.some((option) => option.name === value), value);
  }
});

test('Self automation invokes the pinned shared workflow with zero long-lived tokens', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const pinnedSha = '14d51168311c25f41d89df370c5e2ad2d5f42e83';
  assert.match(workflow, /^name: Project automation/m);
  assert.match(workflow, /^  issues:/m);
  assert.match(workflow, /^  pull_request_target:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /issue_number:/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /authentication: broker-user/);
  assert.match(workflow, /broker_audience: appfactory-project-automation/);
  assert.match(workflow, /config_path: \.github\/project-config\.json/);
  assert.match(workflow, /appfactory_ref: 14d51168311c25f41d89df370c5e2ad2d5f42e83/);
  assert.match(workflow, new RegExp('reusable-project-automation\\.yml@' + pinnedSha));
  assert.doesNotMatch(workflow, /PROJECT_TOKEN|secrets\.|authentication: token|contents: write/);
});
