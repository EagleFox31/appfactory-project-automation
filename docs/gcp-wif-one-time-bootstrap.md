# Google Cloud Workload Identity Federation bootstrap: verify first, apply once

Like the AWS OIDC trust (`aws-oidc-one-time-bootstrap.md`), the **first Google Cloud trust cannot bootstrap
itself**: a project owner must, once per Firebase project, create a Workload Identity Pool and Provider for
GitHub, a deployment service account, and the bindings that let one repository impersonate it. Nothing in
this document is executed by CI, by this repository, or by committing this file. No key is ever created.

Run every command from an already-authenticated `gcloud` session (Cloud Shell or a workstation) with the
`Owner` or `IAM Admin` + `Service Account Admin` + `Workload Identity Pool Admin` roles on the project.

Placeholders used below:

| Placeholder | Meaning | Example |
|---|---|---|
| `PROJECT_ID` | Firebase / Google Cloud project id | `love-ink` |
| `PROJECT_NUMBER` | numeric project number (`gcloud projects describe`) | `123456789012` |
| `OWNER` / `REPO` | GitHub repository allowed to deploy | `Trigenys` / `loveink` |
| `DEFAULT_BRANCH` | production branch | `main` |
| `SA` | deployment service account email | `github-deploy@PROJECT_ID.iam.gserviceaccount.com` |

## 1. Verification (read-only, no change)

```bash
gcloud config set project PROJECT_ID
gcloud projects describe PROJECT_ID --format='value(projectNumber)'
gcloud services list --enabled --filter='name:(iamcredentials.googleapis.com OR sts.googleapis.com OR firebasehosting.googleapis.com OR firebase.googleapis.com)'
gcloud iam workload-identity-pools describe github --location=global 2>&1 | head -3
gcloud iam workload-identity-pools providers describe github-actions --location=global --workload-identity-pool=github 2>&1 | head -3
gcloud iam service-accounts describe SA 2>&1 | head -3
gcloud projects get-iam-policy PROJECT_ID --flatten='bindings[].members' --filter='bindings.members:SA' --format='table(bindings.role)'
gcloud iam service-accounts get-iam-policy SA --format=json
```

Expected outcome before the first application: pool, provider and service account **not found**; the four
services may need enabling. Record the output. If the pool or provider already exists, compare its
attribute mapping and condition with section 2 before touching anything: reconcile the difference
deliberately, do not recreate.

Desired state (what section 2 converges to):

- pool `github`, provider `github-actions`, issuer `https://token.actions.githubusercontent.com`;
- attribute mapping **must** include `attribute.repository=assertion.repository` (bindings on
  `attribute.repository/...` are silently ineffective otherwise) and `attribute.repository_owner`,
  `attribute.ref`;
- attribute condition `assertion.repository_owner == 'OWNER'`;
- service account `SA` with the minimal roles for the targets the consumer uses:
  `roles/firebasehosting.admin` (Hosting, includes project read), plus `roles/firebaserules.admin` only if
  `firestore:rules` is deployed and `roles/datastore.indexAdmin` only if `firestore:indexes` is deployed;
- `roles/iam.workloadIdentityUser` on `SA` granted to
  `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO`
  and to nothing else. No `roles/owner`, no `roles/editor`, no key.

## 2. Application (explicit, idempotent, one command at a time)

Each command is a no-op or an error if the resource already exists; re-run the verification between steps
rather than guessing.

```bash
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com firebase.googleapis.com

gcloud iam workload-identity-pools create github --location=global --display-name='GitHub Actions'

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location=global --workload-identity-pool=github --display-name='GitHub Actions OIDC' \
  --issuer-uri='https://token.actions.githubusercontent.com' \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref' \
  --attribute-condition="assertion.repository_owner == 'OWNER'"

gcloud iam service-accounts create github-deploy --display-name='GitHub Actions deployment (WIF, no key)'

gcloud projects add-iam-policy-binding PROJECT_ID --member='serviceAccount:SA' --role='roles/firebasehosting.admin' --condition=None
# Only if the consumer deploys Firestore rules / indexes through CI:
# gcloud projects add-iam-policy-binding PROJECT_ID --member='serviceAccount:SA' --role='roles/firebaserules.admin' --condition=None
# gcloud projects add-iam-policy-binding PROJECT_ID --member='serviceAccount:SA' --role='roles/datastore.indexAdmin' --condition=None

gcloud iam service-accounts add-iam-policy-binding SA \
  --role='roles/iam.workloadIdentityUser' \
  --member='principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO'
```

Stricter production-only trust (optional): create a second provider or a second service account whose
`workloadIdentityUser` binding uses
`.../attribute.ref/refs/heads/DEFAULT_BRANCH` instead of `attribute.repository`, and pass that pair to the
workflow for `mode: production` only. The workflow and contract already refuse production from other refs;
this moves the same rule to the Google side.

## 3. Values to give the consumer (not secrets)

```
workload_identity_provider = projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-actions
service_account            = SA
```

Store them as GitHub repository **variables** (`vars.*`). They identify a trust, they do not grant it: a
token minted by a workflow of another repository is rejected by the attribute condition and the binding.

## 4. Re-verification and revocation

Re-run section 1: pool, provider, service account and the single `workloadIdentityUser` binding must be
present and unchanged. To revoke: `gcloud iam service-accounts remove-iam-policy-binding SA --role
roles/iam.workloadIdentityUser --member '...'` (immediate for new tokens; issued access tokens live at most
one hour), or disable the service account.

## Known pitfalls (see `docs/engineering/lessons-learned.md`)

- A missing `attribute.repository` mapping makes the `principalSet` binding ineffective: the workflow fails
  with `invalid_target` / permission denied at the STS step.
- `firebase-tools` 15.22.2 rejects WIF credentials (fixed in 15.22.3); Node 22.23.0 and 24.17.0 crash the CLI.
  The contract refuses these versions.
- The generic "have you run firebase login?" message hides the real cause: rerun with `debug: true`.

**No resource is created by merging this document.**
