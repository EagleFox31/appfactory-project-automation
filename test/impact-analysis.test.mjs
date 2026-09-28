import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeImpact,
  validateConfig,
} from "../src/impact/engine.mjs";

function baseConfig(overrides = {}) {
  return {
    version: 1,
    fallback: "all",
    ignorePaths: ["README.md", "docs/**"],
    surfaces: {
      "shared-contracts": {
        paths: ["packages/contracts/**"],
        gates: [],
      },
      landing: {
        paths: ["apps/landing/**", "scripts/landing/**"],
        gates: ["landing-ci", "pages"],
      },
      desktop: {
        paths: ["src/**", "src-tauri/**", "package.json"],
        gates: ["frontend", "rust", "security", "windows-installer"],
        dependsOn: ["shared-contracts"],
      },
      registry: {
        paths: ["services/registry-api/**"],
        gates: ["registry", "security"],
        dependsOn: ["shared-contracts"],
      },
      release: {
        paths: [
          ".release-please-manifest.json",
          "release-please-config.json",
          "scripts/release/**",
        ],
        gates: ["product-release"],
      },
    },
    ...overrides,
  };
}

test("landing-only changes select only landing gates", () => {
  const result = analyzeImpact(baseConfig(), [
    "apps/landing/favicon.svg",
    "scripts/landing/site-pages.mjs",
  ]);

  assert.deepEqual(result.directSurfaces, ["landing"]);
  assert.deepEqual(result.impactedSurfaces, ["landing"]);
  assert.deepEqual(result.gates, ["landing-ci", "pages"]);
  assert.equal(result.fallbackApplied, false);
});

test("shared dependency changes propagate to dependent surfaces", () => {
  const result = analyzeImpact(baseConfig(), [
    "packages/contracts/schema.json",
  ]);

  assert.deepEqual(result.directSurfaces, ["shared-contracts"]);
  assert.deepEqual(result.impactedSurfaces, [
    "shared-contracts",
    "desktop",
    "registry",
  ]);
  assert.deepEqual(result.gates, [
    "frontend",
    "rust",
    "security",
    "windows-installer",
    "registry",
  ]);
});

test("ignored documentation does not wake product gates", () => {
  const result = analyzeImpact(baseConfig(), [
    "README.md",
    "docs/architecture.md",
  ]);

  assert.deepEqual(result.impactedSurfaces, []);
  assert.deepEqual(result.gates, []);
  assert.deepEqual(result.ignoredFiles, [
    "README.md",
    "docs/architecture.md",
  ]);
  assert.equal(result.fallbackApplied, false);
});

test("unmatched files safely fan out when fallback is all", () => {
  const result = analyzeImpact(baseConfig(), [
    "unknown/new-platform-file.toml",
  ]);

  assert.deepEqual(result.impactedSurfaces, [
    "shared-contracts",
    "landing",
    "desktop",
    "registry",
    "release",
  ]);
  assert.equal(result.fallbackApplied, true);
  assert.deepEqual(result.unmatchedFiles, [
    "unknown/new-platform-file.toml",
  ]);
});

test("fallback none permits explicitly classified no-op changes", () => {
  const config = baseConfig({ fallback: "none" });
  const result = analyzeImpact(config, ["misc/non-product-note.txt"]);

  assert.deepEqual(result.impactedSurfaces, []);
  assert.deepEqual(result.gates, []);
  assert.equal(result.fallbackApplied, false);
});

test("Windows-style paths normalize before matching", () => {
  const result = analyzeImpact(baseConfig(), [
    String.raw`src-tauri\src\scanner\mod.rs`,
  ]);

  assert.deepEqual(result.impactedSurfaces, ["desktop"]);
  assert.ok(result.gates.includes("rust"));
});

test("configuration rejects unknown dependencies", () => {
  const config = baseConfig();
  config.surfaces.desktop.dependsOn = ["missing"];

  assert.throws(
    () => validateConfig(config),
    /depends on unknown surface "missing"/
  );
});

test("configuration rejects dependency cycles", () => {
  const config = baseConfig();
  config.surfaces["shared-contracts"].dependsOn = ["desktop"];

  assert.throws(
    () => validateConfig(config),
    /dependency cycle/
  );
});
