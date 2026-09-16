# Security Policy

## Supported versions

Security fixes are applied to the current major release line. Consumers should pin the Action to the supported major tag:

```yaml
uses: EagleFox31/appfactory-project-automation@v1
```

Using `main` in production workflows is not recommended.

## Reporting a vulnerability

Please do not open a public Issue for a vulnerability that could expose tokens, allow unsafe code execution, mutate unintended GitHub Projects or repositories, or disclose private data.

Report security issues privately through GitHub's private vulnerability reporting feature when it is available for this repository. If private reporting is unavailable, contact the maintainer through the contact method listed on the GitHub profile and include only the minimum information needed to establish a private channel.

A useful report includes:

- the affected Action version or commit;
- the triggering GitHub event and workflow context;
- a minimal reproduction or proof of concept;
- the expected impact;
- any suggested mitigation.

Do not include live access tokens or credentials.

## Security model

The Action is designed so that:

- untrusted pull-request code is not executed by the Action;
- `pull_request_target` consumers can checkout the trusted default branch;
- the Project-capable token is supplied explicitly and is not logged;
- built-in `GITHUB_TOKEN` permissions can remain read-only;
- Project, field and option IDs are resolved at runtime;
- bootstrap operations are scoped to the configured Project owner/title and consuming repository;
- malformed inputs and incompatible field types fail before silent semantic changes.
