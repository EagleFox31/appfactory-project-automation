import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), 'utf8');
}

const pureGovernanceModules = [
  'src/governance/policy.mjs',
  'src/governance/ruleset.mjs',
  'src/governance/adoption.mjs'
];

const governanceModules = [
  ...pureGovernanceModules,
  'src/governance/discovery.mjs',
  'src/governance/plan.mjs',
  'src/governance/preflight.mjs',
  'src/governance/reconcile.mjs',
  'src/governance/execution.mjs'
];

test('policy and desired-state modules remain pure and environment-independent', () => {
  for (const modulePath of pureGovernanceModules) {
    const contents = source(modulePath);
    assert.doesNotMatch(contents, /\bfetch\s*\(/, modulePath);
    assert.doesNotMatch(contents, /process\.env/, modulePath);
    assert.doesNotMatch(contents, /github\/rest-client/, modulePath);
  }
});

test('repository governance remains independent from Project automation internals', () => {
  for (const modulePath of governanceModules) {
    const contents = source(modulePath);
    assert.doesNotMatch(contents, /from ['"]\.\.\/lib\.mjs['"]/, modulePath);
    assert.doesNotMatch(contents, /ProjectV2|project-config|PROJECT_TOKEN/, modulePath);
  }
});

test('transport authentication is injected and policy-free', () => {
  const transport = source('src/github/rest-client.mjs');
  assert.match(transport, /export function createGitHubRestClient\(\{[\s\S]*?token,/);
  assert.match(transport, /fetchImpl = globalThis\.fetch/);
  assert.doesNotMatch(transport, /process\.env/);
  assert.doesNotMatch(transport, /normalizeGovernanceConfig|GOVERNANCE_POLICY_VERSION/);
});

test('execution owns orchestration while reconciliation consumes an injected client', () => {
  const execution = source('src/governance/execution.mjs');
  const reconciliation = source('src/governance/reconcile.mjs');

  assert.match(execution, /clientFactory = createGitHubRestClient/);
  assert.match(execution, /preflightRepositoryGovernance\(\{/);
  assert.match(execution, /planRepositoryRuleset\(\{/);
  assert.match(execution, /applyRepositoryRulesetPlan\(\{ plan, client \}\)/);
  assert.doesNotMatch(reconciliation, /createGitHubRestClient|governanceToken|Authorization/);
  assert.match(reconciliation, /applyRepositoryRulesetPlan\(\{ plan, client \}\)/);
});
