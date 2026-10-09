#!/usr/bin/env bash
# One-time AWS CloudShell bootstrap. Read-only by default.
# Run from repository root: bash scripts/deployment/bootstrap-aws-free-plan-reader.sh [--apply]
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ "${1:-}" != "" && "${1:-}" != "--apply" ]] || [[ "$#" -gt 1 ]]; then
  echo "Usage: bash scripts/deployment/bootstrap-aws-free-plan-reader.sh [--apply]" >&2
  exit 2
fi
# Deprecated: centrally managed staging bootstrap now enforces permissions boundaries.
# Explicitly block the legacy --apply path so it cannot create an unbounded role.
if [[ "${1:-}" == "--apply" ]]; then
  echo "REFUSED: legacy bootstrap --apply is disabled. Use central CloudFormation onboarding described in docs/aws-central-staging-iam-bootstrap.md" >&2
  exit 1
fi
for command in aws grep; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 2; }; done

# Pilot configuration is explicit and fixed; later projects must be onboarded
# through a reviewed registry entry, never untrusted PR-supplied AWS parameters.
expected_account="458018461157"
region="eu-west-3"
project="precis-translation"
environment="staging"
github_owner="EagleFox31"
github_owner_id="86088743"
github_repository="Pr-cis-Translation"
github_repository_id="1411758415"
stack_name="precis-staging-iam-readonly"
template="infra/aws/appfactory-free-plan-reader.yml"
provider="arn:aws:iam::${expected_account}:oidc-provider/token.actions.githubusercontent.com"

identity="$(aws sts get-caller-identity --query Account --output text --region "$region")"
if [[ "$identity" != "$expected_account" ]]; then
  echo "REFUSED: AWS session belongs to $identity, expected $expected_account" >&2
  exit 1
fi

audience="$(aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "$provider" \
  --query "contains(ClientIDList, 'sts.amazonaws.com')" --output text)"
if [[ "$audience" != "True" ]]; then
  echo "REFUSED: GitHub OIDC provider missing audience sts.amazonaws.com" >&2
  exit 1
fi
test -s "$template" || { echo "Template unavailable; run from checked-out AppFactory root" >&2; exit 1; }

echo "Verified AWS account: $identity"
echo "Verified existing GitHub OIDC provider audience: sts.amazonaws.com"
echo "Requested stack: $stack_name; IAM role: $project-$environment-free-plan-read"
echo "Permitted AWS action for the created role: freetier:GetAccountPlanState only"
if [[ "${1:-}" != "--apply" ]]; then
  echo "DRY RUN ONLY: no changes have been made. The legacy --apply path is disabled."
  exit 0
fi
