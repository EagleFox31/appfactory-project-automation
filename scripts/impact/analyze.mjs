#!/usr/bin/env node

import { readFile, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { analyzeImpact } from "../../src/impact/engine.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(process.cwd(), args.config ?? ".github/appfactory-impact.json");
const mode = args.mode ?? "auto";

if (!["auto", "all"].includes(mode)) {
  throw new Error('Impact analysis mode must be "auto" or "all".');
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const range = mode === "all" ? { forceAll: true, reason: "explicit-full-run" } : await resolveRange(args);
const changedFiles = range.forceAll ? [] : gitChangedFiles(range.base, range.head);
const effectiveConfig = range.forceAll ? { ...config, fallback: "all" } : config;
const analysis = analyzeImpact(effectiveConfig, changedFiles);

const payload = {
  ...analysis,
  range: range.forceAll
    ? { mode: "all", reason: range.reason }
    : { mode: "diff", base: range.base, head: range.head, reason: range.reason },
};

const compact = JSON.stringify(payload);
console.log(JSON.stringify(payload, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `surfaces=${JSON.stringify(payload.impactedSurfaces)}`,
      `gates=${JSON.stringify(payload.gates)}`,
      `changed_files_count=${payload.changedFiles.length}`,
      `fallback_applied=${payload.fallbackApplied}`,
      `analysis=${compact}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

async function resolveRange(options) {
  if (options.base && options.head) {
    return {
      base: options.base,
      head: options.head,
      reason: "explicit-inputs",
      forceAll: false,
    };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return { forceAll: true, reason: "missing-github-event" };
  }

  const event = JSON.parse(await readFile(eventPath, "utf8"));

  if (event.pull_request?.base?.sha && event.pull_request?.head?.sha) {
    return {
      base: event.pull_request.base.sha,
      head: event.pull_request.head.sha,
      reason: "pull-request",
      forceAll: false,
    };
  }

  if (event.before && event.after) {
    if (/^0+$/.test(event.before)) {
      return { forceAll: true, reason: "push-without-base" };
    }

    return {
      base: event.before,
      head: event.after,
      reason: "push",
      forceAll: false,
    };
  }

  return { forceAll: true, reason: "event-without-comparable-range" };
}

function gitChangedFiles(base, head) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRD", base, head],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(
      `git diff failed for ${base}..${head}: ${result.stderr || result.stdout}`
    );
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }

    parsed[key] = value;
    index += 1;
  }

  return {
    config: parsed.config,
    mode: parsed.mode,
    base: parsed.base,
    head: parsed.head,
  };
}
