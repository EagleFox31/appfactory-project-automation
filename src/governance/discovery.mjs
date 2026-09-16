function assertRepositoryIdentity(repositoryFullName, repository) {
  if (
    typeof repository?.full_name !== 'string'
    || repository.full_name.toLowerCase() !== repositoryFullName.toLowerCase()
  ) {
    throw new Error(
      `GitHub returned repository "${repository?.full_name || '(unknown)'}" while inspecting `
      + `"${repositoryFullName}".`
    );
  }
}

function defaultBranchFrom(repository) {
  const defaultBranch = typeof repository?.default_branch === 'string'
    ? repository.default_branch.trim()
    : '';
  if (!defaultBranch) {
    throw new Error('GitHub repository metadata does not expose a valid default branch.');
  }
  return defaultBranch;
}

export async function discoverRepositoryGovernanceState({
  repositoryFullName,
  client,
  repository: suppliedRepository
}) {
  if (!client) throw new Error('A repository governance client is required for discovery.');

  const repository = suppliedRepository ?? await client.getRepository(repositoryFullName);
  assertRepositoryIdentity(repositoryFullName, repository);
  const defaultBranch = defaultBranchFrom(repository);

  const [rulesets, classicBranchProtection] = await Promise.all([
    client.listRepositoryRulesets(repositoryFullName),
    client.getBranchProtection(repositoryFullName, defaultBranch)
  ]);
  if (!Array.isArray(rulesets)) {
    throw new Error('GitHub returned an invalid repository ruleset collection.');
  }
  if (
    classicBranchProtection !== null
    && (typeof classicBranchProtection !== 'object' || Array.isArray(classicBranchProtection))
  ) {
    throw new Error('GitHub returned invalid classic branch-protection data.');
  }

  return {
    repositoryFullName: repository.full_name,
    visibility: repository.visibility ?? (repository.private ? 'private' : 'public'),
    defaultBranch,
    rulesets,
    classicBranchProtection
  };
}
