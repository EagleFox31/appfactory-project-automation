import { GitHubRestError, createGitHubRestClient } from '../github/rest-client.mjs';
import { discoverRepositoryGovernanceState } from './discovery.mjs';

const GOVERNANCE_PERMISSION = 'Administration: write';

export class GovernancePreflightError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'GovernancePreflightError';
    this.code = code;
  }
}

function failure(message, code) {
  return new GovernancePreflightError(message, { code });
}

export function requireGovernanceCredential(policy, governanceToken) {
  if (!policy?.enabled) return null;

  if (typeof governanceToken !== 'string' || !governanceToken.trim()) {
    throw failure(
      'Repository governance is enabled, but input "governance-token" is missing. ' +
      `Create a dedicated GitHub credential for the target repository with ${GOVERNANCE_PERMISSION} ` +
      'permission, store it as an Actions secret, and pass that secret to "governance-token".',
      'credential-missing'
    );
  }

  return governanceToken.trim();
}

function repositoryMismatch(repositoryFullName, observedFullName) {
  return failure(
    `Governance credential resolved repository "${observedFullName || '(unknown)'}" instead of ` +
    `"${repositoryFullName}". Verify GITHUB_REPOSITORY and the repositories selected for the token.`,
    'repository-mismatch'
  );
}

function permissionFailure(repositoryFullName) {
  return failure(
    `Governance credential can read "${repositoryFullName}" but does not have repository admin ` +
    `capability. Grant ${GOVERNANCE_PERMISSION} permission for this repository.`,
    'administration-required'
  );
}

function transportFailure(error, repositoryFullName) {
  if (!(error instanceof GitHubRestError)) return error;

  if (error.status === 401) {
    return failure(
      'Governance credential is invalid or expired. Replace the Actions secret and retry.',
      'credential-invalid'
    );
  }
  if (error.status === 403) {
    return failure(
      `Governance credential cannot inspect "${repositoryFullName}". Grant ` +
      `${GOVERNANCE_PERMISSION} permission and authorize the credential for the repository or organization.`,
      'credential-forbidden'
    );
  }
  if (error.status === 404) {
    return failure(
      `Governance credential cannot see "${repositoryFullName}". Select this repository for the ` +
      'credential and, for organization repositories, confirm that the organization has approved it.',
      'repository-not-visible'
    );
  }

  return failure(
    `Repository governance preflight could not inspect "${repositoryFullName}" ` +
    `(GitHub HTTP ${error.status ?? 'unknown'}). Retry after GitHub API access is restored.`,
    'github-unavailable'
  );
}

export async function preflightRepositoryGovernance({
  repositoryFullName,
  policy,
  governanceToken,
  clientFactory = createGitHubRestClient
}) {
  if (!policy?.enabled) {
    return { status: 'disabled', repositoryFullName, rulesetCount: 0 };
  }

  const credential = requireGovernanceCredential(policy, governanceToken);
  const client = clientFactory({ token: credential });

  try {
    const repository = await client.getRepository(repositoryFullName);
    if (
      typeof repository?.full_name !== 'string'
      || repository.full_name.toLowerCase() !== repositoryFullName.toLowerCase()
    ) {
      throw repositoryMismatch(repositoryFullName, repository?.full_name);
    }
    if (repository.permissions?.admin !== true) {
      throw permissionFailure(repositoryFullName);
    }

    const discovery = await discoverRepositoryGovernanceState({
      repositoryFullName,
      client,
      repository
    });
    return {
      status: 'ready',
      repositoryFullName: repository.full_name,
      visibility: discovery.visibility,
      defaultBranch: discovery.defaultBranch,
      rulesetCount: discovery.rulesets.length,
      classicBranchProtection: discovery.classicBranchProtection !== null,
      discovery
    };
  } catch (error) {
    if (error instanceof GovernancePreflightError) throw error;
    throw transportFailure(error, repositoryFullName);
  }
}
