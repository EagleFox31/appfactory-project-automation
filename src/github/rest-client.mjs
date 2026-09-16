const DEFAULT_API_BASE_URL = 'https://api.github.com';
const DEFAULT_API_VERSION = '2026-03-10';
const DEFAULT_USER_AGENT = 'AppFactory-Project-Automation';

export class GitHubRestError extends Error {
  constructor(message, { status, method, path, response } = {}) {
    super(message);
    this.name = 'GitHubRestError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.response = response;
  }
}

export function parseRepositoryFullName(repositoryFullName) {
  if (typeof repositoryFullName !== 'string') {
    throw new Error('repositoryFullName must be an owner/name string.');
  }

  const parts = repositoryFullName.trim().split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Invalid repositoryFullName: "${repositoryFullName}". Expected owner/name.`);
  }

  return { owner: parts[0], repository: parts[1] };
}

function responseMessage(payload, response) {
  if (payload && typeof payload === 'object' && typeof payload.message === 'string') {
    return payload.message;
  }
  return response.statusText || 'Request failed';
}

function normalizedBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('apiBaseUrl must be an absolute HTTP(S) URL.');
  }
  return baseUrl;
}

export function createGitHubRestClient({
  token,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  apiVersion = DEFAULT_API_VERSION,
  userAgent = DEFAULT_USER_AGENT
} = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('A GitHub token is required to create the REST client.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function.');
  }

  const baseUrl = normalizedBaseUrl(apiBaseUrl);
  const authorization = `Bearer ${token.trim()}`;

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: authorization,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'X-GitHub-Api-Version': apiVersion
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });

    const rawBody = await response.text();
    let payload = null;
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = rawBody;
      }
    }

    if (!response.ok) {
      const message = responseMessage(payload, response);
      throw new GitHubRestError(
        `GitHub REST ${method} ${path} failed with HTTP ${response.status}: ${message}`,
        { status: response.status, method, path, response: payload }
      );
    }

    return payload;
  }

  function rulesetsPath(repositoryFullName, rulesetId) {
    const { owner, repository } = parseRepositoryFullName(repositoryFullName);
    const root = `${repositoryPath(repositoryFullName)}/rulesets`;
    if (rulesetId === undefined) return root;
    if (!Number.isSafeInteger(rulesetId) || rulesetId <= 0) {
      throw new Error(`rulesetId must be a positive safe integer, got: ${rulesetId}.`);
    }
    return `${root}/${rulesetId}`;
  }

  function repositoryPath(repositoryFullName) {
    const { owner, repository } = parseRepositoryFullName(repositoryFullName);
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  }

  function branchProtectionPath(repositoryFullName, branchName) {
    if (typeof branchName !== 'string' || !branchName.trim()) {
      throw new Error('branchName must be a non-empty string.');
    }
    return `${repositoryPath(repositoryFullName)}/branches/${encodeURIComponent(branchName.trim())}/protection`;
  }

  return Object.freeze({
    getRepository(repositoryFullName) {
      return request('GET', repositoryPath(repositoryFullName));
    },

    async getBranchProtection(repositoryFullName, branchName) {
      try {
        return await request('GET', branchProtectionPath(repositoryFullName, branchName));
      } catch (error) {
        if (error instanceof GitHubRestError && error.status === 404) return null;
        throw error;
      }
    },

    async listRepositoryRulesets(repositoryFullName) {
      const result = [];
      for (let page = 1; page <= 100; page += 1) {
        const payload = await request('GET', rulesetsPath(repositoryFullName), {
          query: {
            includes_parents: false,
            targets: 'branch',
            per_page: 100,
            page
          }
        });
        if (!Array.isArray(payload)) {
          throw new Error('GitHub returned an invalid repository ruleset collection.');
        }
        result.push(...payload);
        if (payload.length < 100) return result;
      }
      throw new Error('Repository ruleset pagination exceeded the 10,000-item safety limit.');
    },

    getRepositoryRuleset(repositoryFullName, rulesetId) {
      return request('GET', rulesetsPath(repositoryFullName, rulesetId), {
        query: { includes_parents: false }
      });
    },

    createRepositoryRuleset(repositoryFullName, payload) {
      return request('POST', rulesetsPath(repositoryFullName), { body: payload });
    },

    updateRepositoryRuleset(repositoryFullName, rulesetId, payload) {
      return request('PUT', rulesetsPath(repositoryFullName, rulesetId), { body: payload });
    }
  });
}
