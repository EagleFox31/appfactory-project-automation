# AWS/SSM target preflight (issue #75, phase 2a)

The reusable workflow `.github/workflows/reusable-container-ssm-preflight.yml` **only inspects** a prospective AWS instance. It does **not** send SSM commands, build/push images, modify EC2, create AWS infrastructure, open any network port, overwrite data or deploy an application.

## Why inspection is separate

Atelier Maître deploys to its own EC2 instance and IAM role. Précis must never reuse that target simply because the service is also containerized. This workflow fails unless the consumer describes a **dedicated, existing** Linux instance that proves its identity through:
- exact AWS account derived from a dedicated role ARN named `projectId-environment` (or `projectId-environment-*`);
- exact EC2 instance ID, required state `running` and Linux platform;
- three mandatory EC2 tags: `AppFactoryProject`, `AppFactoryEnvironment`, `AppFactoryRepository`;
- online SSM managed-instance status (Linux only);
- compatible target CPU architecture for **every** configured image;
- tenant-specific SSM Parameter Store prefix `/appfactory/<projectId>/<environment>/` and Compose project `<projectId>-<environment>`.

The workflow first validates the consumer config locally, without AWS credentials. Only after a successful validation does it assume an explicitly configured IAM role using GitHub Actions OIDC in the consumer's named GitHub environment. The assumed role must be trusted by the exact consumer repository and the protected environment, not a wildcard and **never** a shared Atelier role.

Minimum read-only AWS IAM policy: `ec2:DescribeInstances`, `ssm:DescribeInstanceInformation` and `sts:GetCallerIdentity`. The latter is implicitly available for AWS role identity. No `ssm:SendCommand` or `ssm:GetParameter` is needed for this inspection.

## Consumer profile snippet

For a separately provisioned *staging* instance only, add this section to the validated consumer config (replace placeholders with real resource IDs; **do not** copy Atelier values):

```json
{
  "deployment": {
    "transport": "aws-ssm",
    "region": "eu-west-3",
    "roleArn": "arn:aws:iam::123456789012:role/precis-translation-staging",
    "instanceId": "i-abcdef01234567890",
    "ssmParameterPrefix": "/appfactory/precis-translation/staging/",
    "composeProject": "precis-translation-staging",
    "healthPath": "/health",
    "serviceNames": ["backend", "web"]
  }
}
```

Only append the **deployment** section to the existing document; it is not a standalone consumer config. Those ARNs/IDs are **illustrative placeholders**, not allocated infrastructure.

## Caller workflow: opt-in manual inspection

Use a reviewed immutable AppFactory commit SHA for both the reusable-workflow reference and `appfactory_ref`:

```yaml
name: Inspect staging target
on:
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
jobs:
  inspect:
    uses: EagleFox31/appfactory-project-automation/.github/workflows/reusable-container-ssm-preflight.yml@APPFACTORY_REVIEWED_SHA
    with:
      config_path: .github/appfactory-deploy.json
      appfactory_ref: APPFACTORY_REVIEWED_SHA
      environment: staging
      source_sha: ${{ github.sha }}
```

Enable GitHub Environment reviewers for elevated environments in the **consumer**. Avoid attaching this workflow to PRs or ordinary branch pushes: the read-only container-plan workflow is designed for those triggers and does not receive OIDC credentials.

## Deliberate limitations

1. This verifies **existing instance identity**, not who pays for the instance. It does not create/resize resources, and cannot claim the AWS account is within Free Tier. Only run `inspect` when a target and explicit budget already exist.
2. SSM preflight does not prove sufficient disk/RAM, private GHCR pull authentication, persistent-storage backup, availability of Docker/Compose, service routing or the ability to finish a document-translation job without interruption.
3. It cannot deploy or roll back. Implement those in a separately reviewed and approved phase 2b/3 with CI provenance, image digest manifest, actual backup/restore, quiescence/drain and rollback guarantees.
4. Private Précis must keep its API/backend credentials server-only. Its `VITE_API_KEY` is compiled into a browser bundle and must be treated as public.
5. There is no approved AWS target for Précis as of this PR. **No live AWS test has been performed.**

## Regression tests

`npm test` covers wrong AWS accounts, roles, tags, repository, environments, non-Linux/offline instances and unsupported image architectures. The workflow test checks that no AWS mutation API is present.
