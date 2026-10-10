# AppFactory Visual QA — reusable rendered frontend gate

Feature owner: [Project Automation #99](https://github.com/EagleFox31/appfactory-project-automation/issues/99)  
Product/art direction owner: [Trigenys AppFactory #120](https://github.com/Trigenys/appfactory/issues/120)

## Purpose

Run an **actual local web application** in unprivileged GitHub Actions and collect **desktop/mobile full-page screenshots, keyboard/focus checks, WCAG axe smoke checks, reduced-motion preference/CTA checks, broken/external imagery, console errors and measured Lighthouse LCP/CLS/TBT**. Gate each required check as `PASS`, `FAIL` or `NOT_RUN`; never infer a screenshot from source code.

AppFactory Project Automation owns reusable CI **execution**, not UI design, source selection, motion recipes or production deployments. This workflow does **not** push Cloudflare/Vercel/AWS artifacts, import external UI code, or require project/cloud secrets.

## Consumer adoption (once, versioned as code)

Copy [Visual QA config](../examples/visual-qa-config.json) to your consumer's `.github/appfactory-visual-qa.json` and update its route, visible primary CTA selector and **actual** href. Provide exactly two named viewports (`desktop`, `mobile`). Configure numeric quality budgets.

Typical values:

| Field | Default recommendation | Purpose |
| --- | --- | --- |
| desktop viewport | 1440 × 900 | Full page desktop capture |
| mobile viewport | 390 × 844 | Real mobile viewport capture |
| maxLcpMs | 2500 | Lighthouse LCP lab goal |
| maxCls | 0.10 | Lighthouse CLS lab goal |
| maxTotalBlockingTimeMs | 200 | Lighthouse TBT lab goal |
| requireReducedMotion | true | Check reduced-motion media query and CTA usability |
| requireNoHorizontalOverflow | true | No unexpected scroll outside viewport |
| requireNoExternalImages | true | Flag image network requests to other origins |

All three security flags are compulsory in v1. A route must be a local pathname and have a required primary CTA selector and expected local `href`. For extra pages, add more routes with their own real primary CTA.

**Do not weaken the numbers to obtain a green result**. Lab performance is sensitive to runner conditions: document a reasoned, reviewed exception if the budget is inappropriate, and keep the numerical result visible.

Next, copy the [Impact-Aware config example](../examples/visual-qa-impact.json) into `.github/appfactory-impact.json` (or merge its frontend surface into your existing file). Add the `visual-qa` gate to the frontend paths. No independent duplicated path-filter engine is added.

Copy the [caller workflow example](../examples/visual-qa-impact-aware-ci.yml) into a consumer workflow, replacing **both** `REVIEWED_IMMUTABLE_SHA` placeholders with the same reviewed **full commit SHA**. The `impact` job computes the frontend gate; the reusable visual job runs **only** when `visual-qa` is among the selected gates. Unrelated classified backend-only changes do not start Chromium.

Both consumer and trusted runtime checkouts are read-only, with `contents:read`, `persist-credentials:false`, **no inherited secrets**, and no `pull_request_target` execution. Use `pull_request` for code under review.

## Start/build contract

The reusable workflow accepts `install_command`, `build_command`, `start_command`, `server_url` and `config_path`. The defaults suit an ordinary Vite consumer:

```sh
npm ci --no-audit --no-fund
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

These are **consumer-owned commands** executed without privileged credentials. They must **not** deploy. The runner only accepts `http://127.0.0.1:<unprivileged-port>/` or localhost, never production or arbitrary external URLs. A local server is awaited for up to two minutes and shut down after the run.

Consumer dependency installation is distinct from pinned **isolated test dependencies** (Playwright, axe-core Playwright and Lighthouse) in a temporary directory. Tests use a GitHub runner's headless Chromium; no browser is installed into the consumer's repository.

One actual no-secret/browser smoke test is provided by `.github/workflows/visual-qa-self-test.yml` on changes to the runner/fixture: it launches `test/fixtures/visual-qa-site/server.mjs` and exercises the reusable workflow. The self-test uses **permissive fixture-specific** Lighthouse budgets to verify the measurement plumbing; real consumer thresholds remain conservative by default.

## Evidence and failure semantics

Each mandatory route × viewport requires these outcomes:

- route renders with HTTP success;
- no horizontal overflow;
- no broken or HTTP-error images;
- no unreviewed cross-origin image request;
- primary CTA visible with the declared internal destination;
- reachable primary CTA via repeated Tab presses with visible focus;
- axe reports no serious/critical WCAG 2.0/2.1 A/AA violations;
- full-page screenshot was actually written;
- reduced-motion browser preference active and CTA visible;
- no browser-console errors or unhandled page exceptions;
- Lighthouse produces **real** LCP, CLS, TBT numbers within the consumer-configured limits.

Screenshots, reduced-motion screenshots, raw Lighthouse JSON, `result.json` and `summary.md` are uploaded through `actions/upload-artifact@v4` **even if the QA runner fails**. The run's `GITHUB_STEP_SUMMARY` gets a gate table. Missing/invalid Lighthouse metrics and missing checks fail closed; a failed/skipped test is **never** converted to PASS.

**Limitations requiring later review**: the reduced-motion check verifies the browser preference and functional CTA, not every third-party animation timeline; axe is a smoke test, not a full manual accessibility audit; simulated Lighthouse metrics are lab values, not field INP or Core Web Vitals; lazy media is scrolled into view up to a capped iteration count. Tests use the built local app, not a cloud production deployment. These limitations are surfaced rather than hidden.

## Proof of reusability

This repo has no mandatory npm dependencies for its existing governance/project/release features. The new standalone runner's dependencies are installed only in the selected Visual QA workflow.

Run source-level contract tests locally:

```sh
npm test
```

Run the actual browser self-test through the PR workflow. Only claim end-to-end render validation **after** it has successfully completed and uploaded screenshot/Lighthouse artifacts. A fully green `npm test` alone is not sufficient.

## RAIDER and boundaries

- **Reusable**: consumer JSON config + shared workflow, no product-specific runtime.
- **Agnostic**: consumer chooses install/build/start steps, as long as it serves local HTTP.
- **Idempotent**: artifacts are regenerated per run without changing consumer source.
- **Durable/non-regressive**: the QA workflow is opt-in; normal Project Automation, release/governance and deployment functions are untouched.
- **Engineering-grade**: strict fail-closed config, real browser/Lighthouse evidence, bounded runtime.
- **Retroactive**: an existing React/Vite app can onboard without framework or deployment migration.

When this feature is accepted, AppFactory #143 will add the client-side config/Impact-Aware gate for Commerce Factory and perform the product's actual desktop/mobile screenshots and conversion-flow checks. Do **not** claim the consumer is verified merely because this reusable workflow exists.
