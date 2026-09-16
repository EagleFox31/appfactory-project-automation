function enabled(setting) {
  return setting?.enabled === true;
}

function stableStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string').map((value) => value.trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function classicStatusChecks(protection) {
  const settings = protection?.required_status_checks;
  if (!settings) return [];
  const fromChecks = Array.isArray(settings.checks)
    ? settings.checks.map((entry) => entry?.context)
    : [];
  return stableStrings([
    ...(Array.isArray(settings.contexts) ? settings.contexts : []),
    ...fromChecks
  ]);
}

function classicSummary(defaultBranch, protection) {
  if (!protection) {
    return {
      present: false,
      branch: defaultBranch,
      requiredApprovals: 0,
      requiredStatusChecks: [],
      extraRequirements: []
    };
  }

  const extraRequirements = [];
  if (enabled(protection.required_linear_history)) extraRequirements.push('linear history');
  if (enabled(protection.required_signatures)) extraRequirements.push('signed commits');
  if (enabled(protection.lock_branch)) extraRequirements.push('locked branch');
  if (protection.restrictions) extraRequirements.push('push restrictions');
  if (enabled(protection.enforce_admins)) extraRequirements.push('admin enforcement');

  return {
    present: true,
    branch: defaultBranch,
    requiresPullRequest: Boolean(protection.required_pull_request_reviews),
    requiredApprovals: Number(
      protection.required_pull_request_reviews?.required_approving_review_count ?? 0
    ),
    requiredStatusChecks: classicStatusChecks(protection),
    strictStatusChecks: Boolean(protection.required_status_checks?.strict),
    dismissStaleReviews: Boolean(
      protection.required_pull_request_reviews?.dismiss_stale_reviews
    ),
    requireCodeOwners: Boolean(
      protection.required_pull_request_reviews?.require_code_owner_reviews
    ),
    requireLastPushApproval: Boolean(
      protection.required_pull_request_reviews?.require_last_push_approval
    ),
    resolveReviewThreads: enabled(protection.required_conversation_resolution),
    allowsForcePushes: enabled(protection.allow_force_pushes),
    allowsDeletions: enabled(protection.allow_deletions),
    extraRequirements
  };
}

function sameStrings(left, right) {
  return JSON.stringify(stableStrings(left)) === JSON.stringify(stableStrings(right));
}

function classicFindings(policy, classic) {
  if (!classic.present) return [];

  const findings = [{
    code: 'classic-protection-preserved',
    level: 'notice',
    message: `Classic protection on "${classic.branch}" is preserved and will layer with the AppFactory Ruleset.`
  }];

  if (classic.requiredApprovals !== policy.pullRequest.requiredApprovingReviewCount) {
    findings.push({
      code: 'layered-review-count',
      level: 'warning',
      message: `Classic protection requires ${classic.requiredApprovals} approving review(s), while AppFactory configures ${policy.pullRequest.requiredApprovingReviewCount}; GitHub enforces the more restrictive effective policy.`
    });
  }

  const reviewDifferences = [
    ['pull requests required', classic.requiresPullRequest, policy.pullRequest.required],
    [
      'dismiss stale reviews',
      classic.dismissStaleReviews,
      policy.pullRequest.dismissStaleReviewsOnPush
    ],
    ['CODEOWNERS review', classic.requireCodeOwners, policy.pullRequest.requireCodeOwnerReview],
    [
      'last-push approval',
      classic.requireLastPushApproval,
      policy.pullRequest.requireLastPushApproval
    ],
    [
      'review-thread resolution',
      classic.resolveReviewThreads,
      policy.pullRequest.requiredReviewThreadResolution
    ]
  ].filter(([, classicValue, appFactoryValue]) => classicValue !== appFactoryValue);
  if (reviewDifferences.length) {
    findings.push({
      code: 'layered-review-policy',
      level: 'warning',
      message: `Classic and AppFactory review settings differ for: ${reviewDifferences.map(([name]) => name).join(', ')}; GitHub layers both policies.`
    });
  }
  if (!sameStrings(classic.requiredStatusChecks, policy.requiredStatusChecks)) {
    findings.push({
      code: 'layered-status-checks',
      level: 'warning',
      message: `Classic required checks (${classic.requiredStatusChecks.join(', ') || 'none'}) differ from AppFactory checks (${policy.requiredStatusChecks.join(', ') || 'none'}); both protection layers remain effective.`
    });
  }
  if (
    (classic.requiredStatusChecks.length || policy.requiredStatusChecks.length)
    && classic.strictStatusChecks !== true
  ) {
    findings.push({
      code: 'layered-status-check-strictness',
      level: 'warning',
      message: 'Classic status checks do not require an up-to-date branch, while the AppFactory Ruleset does.'
    });
  }
  if (classic.allowsForcePushes !== !policy.preventForcePush) {
    findings.push({
      code: 'layered-force-push-policy',
      level: 'warning',
      message: `Classic protection ${classic.allowsForcePushes ? 'allows' : 'blocks'} force pushes, while the AppFactory Ruleset ${policy.preventForcePush ? 'blocks' : 'allows'} them.`
    });
  }
  if (classic.allowsDeletions !== !policy.preventDeletion) {
    findings.push({
      code: 'layered-deletion-policy',
      level: 'warning',
      message: `Classic protection ${classic.allowsDeletions ? 'allows' : 'blocks'} branch deletion, while the AppFactory Ruleset ${policy.preventDeletion ? 'blocks' : 'allows'} it.`
    });
  }
  if (classic.extraRequirements.length) {
    findings.push({
      code: 'manual-requirements-preserved',
      level: 'notice',
      message: `Additional classic requirements remain manual and untouched: ${classic.extraRequirements.join(', ')}.`
    });
  }
  return findings;
}

export function buildBrownfieldAdoptionReport({ policy, discovery, managedRuleset }) {
  const unrelatedRulesets = discovery.rulesets
    .filter((ruleset) => ruleset.id !== managedRuleset?.id)
    .map((ruleset) => ({
      id: ruleset.id ?? null,
      name: String(ruleset.name ?? '(unnamed ruleset)'),
      enforcement: String(ruleset.enforcement ?? 'unknown')
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const classicBranchProtection = classicSummary(
    discovery.defaultBranch,
    discovery.classicBranchProtection
  );
  const findings = classicFindings(policy, classicBranchProtection);

  if (unrelatedRulesets.length) {
    findings.push({
      code: 'unrelated-rulesets-preserved',
      level: 'notice',
      message: `${unrelatedRulesets.length} unrelated repository Ruleset(s) remain untouched; active GitHub rules are aggregated.`
    });
  }

  return {
    defaultBranch: discovery.defaultBranch,
    classicBranchProtection,
    unrelatedRulesets,
    findings
  };
}
