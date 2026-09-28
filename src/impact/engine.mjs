import { matchesGlob } from "node:path";

const FALLBACK_MODES = new Set(["all", "none"]);

export function analyzeImpact(config, changedFiles) {
  validateConfig(config);

  const files = [...new Set((changedFiles ?? []).map(normalizePath).filter(Boolean))];
  const surfaceEntries = Object.entries(config.surfaces);
  const direct = new Set();
  const ignored = [];
  const unmatched = [];

  for (const file of files) {
    const matched = surfaceEntries
      .filter(([, surface]) => matchesAny(file, surface.paths))
      .map(([name]) => name);

    if (matched.length > 0) {
      matched.forEach((name) => direct.add(name));
      continue;
    }

    if (matchesAny(file, config.ignorePaths ?? [])) {
      ignored.push(file);
      continue;
    }

    unmatched.push(file);
  }

  if (files.length === 0 && config.fallback === "all") {
    surfaceEntries.forEach(([name]) => direct.add(name));
  }

  if (unmatched.length > 0 && config.fallback === "all") {
    surfaceEntries.forEach(([name]) => direct.add(name));
  }

  const impacted = propagateDependencies(config.surfaces, direct);
  const gates = [];
  const seenGates = new Set();

  for (const [name, surface] of surfaceEntries) {
    if (!impacted.has(name)) continue;
    for (const gate of surface.gates ?? []) {
      if (!seenGates.has(gate)) {
        seenGates.add(gate);
        gates.push(gate);
      }
    }
  }

  return {
    version: 1,
    changedFiles: files,
    directSurfaces: orderedNames(surfaceEntries, direct),
    impactedSurfaces: orderedNames(surfaceEntries, impacted),
    gates,
    ignoredFiles: ignored,
    unmatchedFiles: unmatched,
    fallbackApplied:
      config.fallback === "all" && (files.length === 0 || unmatched.length > 0),
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Impact config must be a JSON object.");
  }

  if (config.version !== 1) {
    throw new Error("Impact config version must be 1.");
  }

  const fallback = config.fallback ?? "all";
  if (!FALLBACK_MODES.has(fallback)) {
    throw new Error('Impact config fallback must be "all" or "none".');
  }
  config.fallback = fallback;

  if (!config.surfaces || typeof config.surfaces !== "object" || Array.isArray(config.surfaces)) {
    throw new Error("Impact config must define a surfaces object.");
  }

  const names = Object.keys(config.surfaces);
  if (names.length === 0) {
    throw new Error("Impact config must define at least one surface.");
  }

  if (config.ignorePaths !== undefined) {
    assertStringArray(config.ignorePaths, "ignorePaths");
  }

  for (const [name, surface] of Object.entries(config.surfaces)) {
    if (!surface || typeof surface !== "object" || Array.isArray(surface)) {
      throw new Error(`Surface "${name}" must be an object.`);
    }

    assertStringArray(surface.paths, `surfaces.${name}.paths`);
    if (surface.paths.length === 0) {
      throw new Error(`Surface "${name}" must declare at least one path.`);
    }

    if (surface.gates !== undefined) {
      assertStringArray(surface.gates, `surfaces.${name}.gates`);
    }

    if (surface.dependsOn !== undefined) {
      assertStringArray(surface.dependsOn, `surfaces.${name}.dependsOn`);
      for (const dependency of surface.dependsOn) {
        if (!names.includes(dependency)) {
          throw new Error(
            `Surface "${name}" depends on unknown surface "${dependency}".`
          );
        }
        if (dependency === name) {
          throw new Error(`Surface "${name}" cannot depend on itself.`);
        }
      }
    }
  }

  assertAcyclic(config.surfaces);
  return config;
}

function propagateDependencies(surfaces, seed) {
  const impacted = new Set(seed);
  let changed = true;

  while (changed) {
    changed = false;

    for (const [name, surface] of Object.entries(surfaces)) {
      if (impacted.has(name)) continue;
      const dependencies = surface.dependsOn ?? [];

      if (dependencies.some((dependency) => impacted.has(dependency))) {
        impacted.add(name);
        changed = true;
      }
    }
  }

  return impacted;
}

function assertAcyclic(surfaces) {
  const visiting = new Set();
  const visited = new Set();

  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Impact surface dependency cycle detected at "${name}".`);
    }

    visiting.add(name);
    for (const dependency of surfaces[name].dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
  }

  Object.keys(surfaces).forEach(visit);
}

function matchesAny(file, patterns) {
  return patterns.some((pattern) => matchesGlob(file, normalizePattern(pattern)));
}

function normalizePattern(pattern) {
  return normalizePath(pattern);
}

function normalizePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

function assertStringArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${path} must be an array of non-empty strings.`);
  }
}

function orderedNames(entries, set) {
  return entries.map(([name]) => name).filter((name) => set.has(name));
}
