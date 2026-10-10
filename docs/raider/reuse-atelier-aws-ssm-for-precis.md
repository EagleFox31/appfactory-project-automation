# AppFactory — Atelier Maître proven AWS/SSM deploy pattern, reusable for Précis

This extracts the real deployment mechanics from
[EagleFox31/atelier2026/.github/workflows/deploy.yml](https://github.com/EagleFox31/atelier2026/blob/main/.github/workflows/deploy.yml)
into `.github/workflows/reusable-aws-ssm-compose-deploy.yml`.

## What is reused

Atelier already uses GitHub OIDC -> CloudFormation deploy with an explicitly
supplied execution role -> GHCR or Docker Compose -> SSM SendCommand, polling,
and an HTTP health gate. AppFactory now supplies the same infrastructure and
remote deployment chain for isolated Compose consumers; Précis supplies its
own `scripts/staging/aws-ssm-compose.sh`, app source, and SSM SecureString
at `/precis-translation/staging/env`.

## What must not be reused

- `atelier-maitre-github-actions-role` has a trust condition restricting it
  to `EagleFox31/atelier2026`; do not change it.
- `atelier-maitre-cloudformation-execution-role` can be passed to
  CloudFormation only under Atelier's original grants.
- Both are tied to `atelier-maitre-prod` and Atelier-only EC2/SSM tags.
- `appfactory-staging-iam-deployer`, which already exists, can currently
  manage only `precis-staging-iam-readonly` and read Free Tier; it cannot
  launch EC2, apply the new Compose host stack, or send SSM commands.
- No AWS principals may self-escalate to fill that gap. An authorized AWS
  administrator must install/approve an **isolated staging provisioner**
  before the reusable workflow's first real apply.

## Binding contract

The reusable workflow, when called from a trusted consumer's protected
`staging` environment on `main`, accepts:

- `project_slug = precis-translation` (same slug used for CloudFormation,
  EC2 tag, and Parameter Store namespace).
- `source_sha = github.sha` (immutable consumer commit).
- `account_id = 458018461157`, `region = eu-west-3`.
- `stack_name = precis-translation-staging-app`.
- `deploy_role_arn = arn:aws:iam::458018461157:role/precis-translation-staging-github-deployer`.
- `cloudformation_role_arn = arn:aws:iam::458018461157:role/precis-translation-staging-cfn-execution`.
- `runtime_parameter = /precis-translation/staging/env`.
- `appfactory_ref = <reviewed immutable SHA>`.

The workflow checks the exact AWS account and Free Plan BEFORE provisioning,
refuses missing runtime SSM credentials BEFORE EC2 spend, discovers a default
VPC/subnet and Amazon Linux 2023 x86 image, validates and deploys the existing
generic 167-hour TTL host template, waits for SSM, and runs the reviewed
consumer script at the requested source SHA.

Précis builds its 3-container DB/LibreOffice API/Nginx frontend Compose
stack on host, reads only its own SSM SecureString, checks public-credential
minimums, disables real payment and mail on staging, and probes both frontend
and API over `127.0.0.1`. The AWS security group remains **ingress-free**;
passing the private health gate does **not** mean the app is publicly reachable
or functional without translation credentials. Public TLS access requires
a separate approved tunnel or DNS/certificate step.

## Remaining real live blockers (do not fake success)

1. An authorized AWS IAM/CFN administrator must provision the **dedicated**
   staging GitHub OIDC execution role and its CFN execution role with
   boundaries `appfactory-staging-ssm-instance-boundary` and
   `appfactory-staging-ttl-scheduler-boundary`. The existing read-only
   AppFactory IAM role cannot install these privileges.
2. An independent secret provisioning action must place the actual required
   `DEEPSEEK_API_KEY`, frontend API key, JWT secret and Postgres password
   inside the **new** `/precis-translation/staging/env` SSM SecureString.
   Never copy Atelier's `/atelier-maitre/prod/env`.
3. Availability, quotas and credit coverage must be confirmed before any
   host creation. Credits do not equal unconditional free use.
4. CloudFormation + SSM live run and private /health must be green. Public
   access through HTTPS, document-backup durability and translation E2E still
   need independent proof.

Do **not** close #120 until a real successful app health check and approved
external endpoint exist. Never say a GitHub syntax-only CI pass means
"Précis deployed".
