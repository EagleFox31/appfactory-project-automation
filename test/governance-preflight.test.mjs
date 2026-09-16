import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubRestError } from '../src/github/rest-client.mjs';
import { normalizeGovernanceConfig } from '../src/governance/policy.mjs';
import {
  GovernancePreflightError,
  preflightRepositoryGovernance,
  requireGovernanceCredential
} from '../src/governance/preflight.mjs';

const REPOSITORY = 'octo-org/product';
const ENABLED = normalizeGovernanceConfig({ enabled: true, preset: 'solo' });
const DISABLED = normalizeGovernanceConfig(undefined);

function preflightClient({
  repository = {
    full_name: REPOSITORY,
    visibility: 'private',
    default_branch: 'main',
    permissions: { admin: true }
  },
  rulesets = [],
  classicBranchProtection = null
} = {}) {
  const calls = [];
  return {
    calls,
    async getRepository(repositoryFullName) {
      calls.push({ operation: 'get', repositoryFullName });
      return structuredClone(repository);
    },
    async listRepositoryRulesets(repositoryFullName) {
      calls.push({ operation: 'list', repositoryFullName });
      return structuredClone(rulesets);
    },
    async getBranchProtection(repositoryFullName, branchName) {
      calls.push({ operation: 'get-protection', repositoryFullName, branchName });
      return structuredClone(classicBranchProtection);
    },
    async createRepositoryRuleset() {
      calls.push({ operation: 'create' });
      throw new Error('preflight must never mutate');
    },
    async updateRepositoryRuleset() {
      calls.push({ operation: 'update' });
      throw new Error('preflight must never mutate');
    }
  };
}

test('disabled governance requires no new credential and performs no transport work', async () => {
  let factoryCalls = 0;
  const result = await preflightRepositoryGovernance({
    repositoryFullName: REPOSITORY,
    policy: DISABLED,
    clientFactory() {
      factoryCalls += 1;
      throw new Error('client must not be created');
    }
  });

  assert.deepEqual(result, {
    status: 'disabled',
    repositoryFullName: REPOSITORY,
    rulesetCount: 0
  });
  assert.equal(factoryCalls, 0);
});

test('enabled governance requires a dedicated credential without falling back to project auth', async () => {
  assert.throws(
    () => requireGovernanceCredential(ENABLED, '   '),
    (error) => {
      assert.ok(error instanceof GovernancePreflightError);
      assert.equal(error.code, 'credential-missing');
      assert.match(error.message, /governance-token/);
      assert.match(error.message, /Administration: write/);
      return true;
    }
  );
});

test('preflight verifies repository identity, admin capability and ruleset visibility', async () => {
  const client = preflightClient({ rulesets: [{ id: 1 }, { id: 2 }] });
  let observedToken = null;

  const result = await preflightRepositoryGovernance({
    repositoryFullName: REPOSITORY,
    policy: ENABLED,
    governanceToken: '  dedicated-secret  ',
    clientFactory({ token }) {
      observedToken = token;
      return client;
    }
  });

  assert.equal(observedToken, 'dedicated-secret');
  assert.equal(result.status, 'ready');
  assert.equal(result.repositoryFullName, REPOSITORY);
  assert.equal(result.visibility, 'private');
  assert.equal(result.defaultBranch, 'main');
  assert.equal(result.rulesetCount, 2);
  assert.equal(result.classicBranchProtection, false);
  assert.deepEqual(result.discovery.rulesets, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(
    client.calls.map((call) => call.operation),
    ['get', 'list', 'get-protection']
  );
  assert.doesNotMatch(JSON.stringify(result), /dedicated-secret/);
});

test('insufficient repository role fails before any mutation', async () => {
  const client = preflightClient({
    repository: {
      full_name: REPOSITORY,
      visibility: 'public',
      default_branch: 'main',
      permissions: { admin: false, push: true }
    }
  });

  await assert.rejects(
    () => preflightRepositoryGovernance({
      repositoryFullName: REPOSITORY,
      policy: ENABLED,
      governanceToken: 'secret',
      clientFactory: () => client
    }),
    (error) => {
      assert.ok(error instanceof GovernancePreflightError);
      assert.equal(error.code, 'administration-required');
      assert.match(error.message, /Administration: write/);
      return true;
    }
  );
  assert.deepEqual(client.calls.map((call) => call.operation), ['get']);
});

test('repository visibility failures are actionable and never expose credential material', async () => {
  const token = 'never-print-this-token';

  await assert.rejects(
    () => preflightRepositoryGovernance({
      repositoryFullName: REPOSITORY,
      policy: ENABLED,
      governanceToken: token,
      clientFactory: () => ({
        async getRepository() {
          throw new GitHubRestError('raw not found', {
            status: 404,
            method: 'GET',
            path: `/repos/${REPOSITORY}`
          });
        }
      })
    }),
    (error) => {
      assert.equal(error.code, 'repository-not-visible');
      assert.match(error.message, /Select this repository/);
      assert.doesNotMatch(error.message, new RegExp(token));
      return true;
    }
  );
});

test('invalid and forbidden credentials produce distinct remediation messages', async () => {
  for (const [status, code, message] of [
    [401, 'credential-invalid', /invalid or expired/],
    [403, 'credential-forbidden', /Administration: write/]
  ]) {
    await assert.rejects(
      () => preflightRepositoryGovernance({
        repositoryFullName: REPOSITORY,
        policy: ENABLED,
        governanceToken: 'secret',
        clientFactory: () => ({
          async getRepository() {
            throw new GitHubRestError('transport failure', { status });
          }
        })
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.match(error.message, message);
        return true;
      }
    );
  }
});
