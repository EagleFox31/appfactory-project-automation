# Production on an existing AWS host

Consumers opt into `github_environment: production`, `deployment_mode: persistent`,
an exact `existing_instance_id` and a public HTTPS `public_origin`. The default
remains staging for existing consumers. Production refuses to provision a
replacement stack, verifies the exact instance before SSM and checks public
health after rollout.

Historical AWS resource names, Parameter Store paths, Compose project names and
volumes remain resource identities. Do not replace stateful infrastructure to
rename a GitHub deployment environment.

OIDC trust must match production before invoking the migrated workflow. For
Précis, the reviewed IAM templates bind the same role and permissions to its
exact production repository subject. Existing accounts need a one-time
administrative trust update; the delivery role cannot rewrite its own trust.
No AWS access key is introduced.
