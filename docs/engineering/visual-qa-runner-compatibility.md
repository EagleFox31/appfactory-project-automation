# Visual QA runner compatibility — 2026-11-19

The Studio CI run 44595696090 failed before browser checks started:
Playwright 1.56.1 cannot install Chromium dependencies on `ubuntu26.04-x64`.
The reusable workflow pinned its auditing tools but used the moving
`ubuntu-latest` runner, so the OS advanced independently of those tools.

Pin Visual QA to `ubuntu-24.04`, which the existing Playwright release
supports. Preserve the auditing tool versions and all browser, accessibility,
performance and evidence gates. No caller input or permission changes.

The existing Visual QA self-test calls this same reusable workflow against
the fixture site and exercises browser installation and the real gates.
Keep this live check when changing either the OS or auditing tool pins.
Treat the browser version and runner image as a compatible pair; a successful
configuration parse or unit test does not prove browser installation works.
