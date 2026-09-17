# GitHub App onboarding

AppFactory Repository Governance can use a short-lived GitHub App installation token instead of a personal access token (PAT). The governance engine still receives the same opaque token, so policy, planning, reconciliation and managed resource identity do not change.

This onboarding model is intended for an App owner managing repositories they control. Register the App once, install it only on selected repositories, and keep its private key in GitHub Actions secrets. A public multi-tenant or Marketplace installation must use a hosted token broker; an App private key must never be distributed to third-party repository owners.

## Minimum permissions

Register the App with only the permissions required by the capabilities that will actually use it.

| Capability | GitHub App permission | Notes |
| --- | --- | --- |
| Repository Governance | Repository **Administration: Read and write** | Required to create or update repository Rulesets. Metadata read access is implicit. |
| Product releases | Repository **Contents: Read and write** | Optional. AppFactory release workflows normally use the repository `GITHUB_TOKEN`, so no App permission is needed unless a consumer deliberately substitutes an App token. |
| Organization-owned Projects | Organization **Projects: Read and write**, plus repository Metadata/Issues/Pull requests read for synchronized content | Applicable only when the configured Project belongs to an organization and the installation is authorized there. |
| User-owned Projects | GitHub App **user access token** with Projects access | Installation tokens do not represent a user. The current Project automation PAT flow remains supported until AppFactory provides a hosted user-authorization and refresh flow. |

Do not add Contents, Issues, Pull requests or Projects write permission merely because another AppFactory capability exists. Governance requests only `Administration: write` when it creates its repository-scoped installation token.

## 1. Register the App

Open **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**.

Use these governance-only settings:

- choose a unique App name;
- use the AppFactory repository URL as the homepage URL;
- disable webhooks when no webhook receiver is deployed;
- set **Repository permissions → Administration** to **Read and write**;
- leave every other mutable permission at **No access**.

After registration:

1. Record the App **Client ID**. GitHub recommends the Client ID for token generation; the legacy numeric App ID is not needed by the provided workflow.
2. Generate one private key and download the PEM file.
3. Install the App on the repository owner account.
4. Select only the repositories that AppFactory is allowed to govern.

The installation selection is the outer access boundary. The workflow then narrows every generated token to its current repository and explicitly requests only `Administration: write`.

## 2. Store the App credentials

In each consumer repository, open **Settings → Secrets and variables → Actions** and create:

- repository variable `APPFACTORY_APP_CLIENT_ID` containing the Client ID;
- repository secret `APPFACTORY_APP_PRIVATE_KEY` containing the complete PEM private key, including the begin/end lines.

For an organization-managed deployment, the same values may be organization-level Actions variable/secret restricted to selected repositories. Never commit the PEM file, copy it into JSON, store it as a plain variable or print it in workflow diagnostics.

## 3. Install the zero-PAT workflow

Copy [`examples/repository-governance-github-app.yml`](../examples/repository-governance-github-app.yml) to `.github/workflows/repository-governance.yml` in the consumer repository.

The reusable workflow:

1. validates the selected authentication provider;
2. uses `actions/create-github-app-token@v3` to create a one-hour installation token;
3. scopes the token to the current repository by omitting broader owner/repository targets;
4. requests only `Administration: write`;
5. passes the masked token to the unchanged AppFactory governance Action;
6. lets the token action revoke the token automatically when the job completes.

Manual `plan` remains the first safe run. Review it, run `apply`, then run `plan` again and expect `NO-OP`.

## Migrating a PAT-backed repository

Migration changes the credential source, not desired state:

1. Install the GitHub App on the existing repository.
2. Add `APPFACTORY_APP_CLIENT_ID` and `APPFACTORY_APP_PRIVATE_KEY`.
3. Replace the PAT-backed workflow with the GitHub App example through the protected pull-request flow.
4. Run `plan`; the existing AppFactory-managed Ruleset must be resolved by its stable name and must not be recreated.
5. Run `apply`, then verify a converged `NO-OP`.
6. Delete `APPFACTORY_GOVERNANCE_TOKEN` only after no remaining workflow references it.

The repository configuration and Ruleset name remain unchanged. AppFactory therefore updates the existing Ruleset by ID when drift exists and performs zero writes when it is already converged.

## Uninstall, reinstall and key rotation

Uninstalling the App prevents future token generation but does not delete the managed Ruleset or any repository configuration. Scheduled runs fail visibly until the App is reinstalled or the workflow returns to PAT authentication.

Reinstalling the same App on the repository does not recreate AppFactory-managed resources. The next run discovers current state and reconciles the same stable Ruleset name.

Rotate a private key by generating the replacement in the App settings, updating `APPFACTORY_APP_PRIVATE_KEY`, validating one workflow run, and only then deleting the old key. GitHub App installation tokens expire after one hour and the token action revokes them at job completion.

## Authentication compatibility contract

The reusable workflow supports two providers:

- `authentication: token` with `secrets.governance_token` — backward-compatible PAT path;
- `authentication: github-app` with `inputs.app_client_id` and `secrets.app_private_key` — zero-PAT governance path.

Exactly one provider is selected explicitly. Missing or mixed assumptions fail before repository checkout or governance execution. The Action's public `governance-token` input remains unchanged, and no core governance module imports GitHub App-specific logic.

Official references:

- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)
- [Repository Rulesets REST API](https://docs.github.com/en/rest/repos/rules)
