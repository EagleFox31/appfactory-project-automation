import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubRestError,
  createGitHubRestClient,
  parseRepositoryFullName
} from '../src/github/rest-client.mjs';

function jsonResponse(status, payload, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => payload === null ? '' : JSON.stringify(payload)
  };
}

test('REST client creates a repository ruleset through the injected transport', async () => {
  const calls = [];
  const client = createGitHubRestClient({
    token: 'secret-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(201, { id: 42 });
    }
  });

  const result = await client.createRepositoryRuleset('octo-org/product', {
    name: 'Managed policy'
  });

  assert.deepEqual(result, { id: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/octo-org/product/rulesets');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'Managed policy' });
});

test('REST client updates the exact managed ruleset with PUT', async () => {
  const calls = [];
  const client = createGitHubRestClient({
    token: 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, { id: 42, enforcement: 'active' });
    }
  });

  const result = await client.updateRepositoryRuleset('octo-org/product', 42, {
    enforcement: 'active'
  });

  assert.equal(result.id, 42);
  assert.equal(calls[0].url, 'https://api.github.com/repos/octo-org/product/rulesets/42');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), { enforcement: 'active' });
});

test('REST client paginates repository-owned branch rulesets', async () => {
  const requestedPages = [];
  const client = createGitHubRestClient({
    token: 'token',
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requestedPages.push(parsed.searchParams.get('page'));
      assert.equal(parsed.searchParams.get('includes_parents'), 'false');
      assert.equal(parsed.searchParams.get('targets'), 'branch');
      const page = Number(parsed.searchParams.get('page'));
      return jsonResponse(200, page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
        : [{ id: 101 }]);
    }
  });

  const result = await client.listRepositoryRulesets('octocat/example');
  assert.equal(result.length, 101);
  assert.deepEqual(requestedPages, ['1', '2']);
});

test('REST errors are actionable without leaking credentials', async () => {
  const token = 'do-not-log-this-token';
  const client = createGitHubRestClient({
    token,
    fetchImpl: async () => jsonResponse(403, {
      message: 'Resource not accessible by personal access token'
    }, 'Forbidden')
  });

  await assert.rejects(
    () => client.getRepositoryRuleset('octocat/example', 42),
    (error) => {
      assert.ok(error instanceof GitHubRestError);
      assert.equal(error.status, 403);
      assert.match(error.message, /Resource not accessible/);
      assert.doesNotMatch(error.message, new RegExp(token));
      assert.doesNotMatch(JSON.stringify(error.response), new RegExp(token));
      return true;
    }
  );
});

test('REST client rejects ambiguous repositories and ruleset ids before transport', () => {
  assert.deepEqual(parseRepositoryFullName('octocat/example'), {
    owner: 'octocat',
    repository: 'example'
  });
  assert.throws(() => parseRepositoryFullName('example'), /Expected owner\/name/);
  assert.throws(() => parseRepositoryFullName('a/b/c'), /Expected owner\/name/);

  const client = createGitHubRestClient({ token: 'token', fetchImpl: async () => null });
  assert.throws(
    () => client.getRepositoryRuleset('octocat/example', 0),
    /positive safe integer/
  );
});
