import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("impact-aware reusable workflow exposes the stable consumer contract", async () => {
  const workflow = await readFile(
    ".github/workflows/reusable-impact-analysis.yml",
    "utf8"
  );

  for (const token of [
    "workflow_call:",
    "appfactory_ref:",
    "config_path:",
    "mode:",
    "surfaces:",
    "gates:",
    "changed_files_count:",
    "fallback_applied:",
    "analysis:",
    "fetch-depth: 0",
    "persist-credentials: false",
    "scripts/impact/analyze.mjs",
  ]) {
    assert.ok(workflow.includes(token), `missing workflow contract token: ${token}`);
  }

  assert.ok(
    !workflow.includes("pull_request_target:"),
    "impact analysis must not introduce pull_request_target execution"
  );
});

test("impact-aware examples keep policy declarative", async () => {
  const config = JSON.parse(
    await readFile("examples/appfactory-impact.json", "utf8")
  );
  const workflow = await readFile("examples/impact-aware-ci.yml", "utf8");

  assert.equal(config.version, 1);
  assert.equal(config.fallback, "all");
  assert.ok(config.surfaces.landing);
  assert.ok(config.surfaces.desktop);
  assert.ok(config.surfaces.release.dependsOn.includes("desktop"));

  assert.ok(workflow.includes("reusable-impact-analysis.yml"));
  assert.ok(workflow.includes("fromJSON(needs.impact.outputs.gates)"));
});
