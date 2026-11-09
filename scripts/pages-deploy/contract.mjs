// Contract for the reusable Cloudflare Pages deployment: validates consumer inputs and the built output
// before any secret is read. Pure functions are exported for tests; the CLI prints a plan and GitHub outputs.
import { readdirSync, statSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
export const MODES = new Set(["plan", "preview", "production"]);

export function assertProjectName(name) {
  if (!PROJECT_NAME_RE.test(String(name || ""))) {
    throw new Error(`project_name "${name}" must be 1-58 chars of lowercase letters, digits and hyphens (Cloudflare Pages project slug)`);
  }
  return name;
}

export function assertMode(mode) {
  if (!MODES.has(mode)) throw new Error(`mode "${mode}" must be one of ${[...MODES].join(", ")}`);
  return mode;
}

// Pages branch for the upload: the production branch deploys to the project's production URL,
// any other branch name creates/updates a preview alias (<branch>.<project>.pages.dev).
export function resolveBranch({ mode, productionBranch, refName }) {
  if (!productionBranch) throw new Error("production_branch is empty: pass it or let the consumer's default branch be discovered");
  if (mode === "production") return productionBranch;
  const safe = String(refName || "preview").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "preview";
  return safe === productionBranch ? `preview-${safe}` : safe;
}

export function inspectDist(dir) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`dist_dir "${dir}" is not a directory: run the build first`);
  let files = 0, bytes = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else { files += 1; bytes += statSync(p).size; }
    }
  };
  walk(dir);
  if (!existsSync(path.join(dir, "index.html"))) throw new Error(`dist_dir "${dir}" has no index.html at its root`);
  if (files > 20000) throw new Error(`dist_dir has ${files} files: Cloudflare Pages accepts at most 20000`);
  return { files, bytes, headers: existsSync(path.join(dir, "_headers")), redirects: existsSync(path.join(dir, "_redirects")) };
}

export function buildPlan(env) {
  const mode = assertMode(env.PAGES_MODE);
  const project = assertProjectName(env.PAGES_PROJECT_NAME);
  const branch = resolveBranch({ mode, productionBranch: env.PAGES_PRODUCTION_BRANCH, refName: env.PAGES_REF_NAME });
  const dist = inspectDist(env.PAGES_DIST_DIR);
  return { mode, project, branch, deploy: mode !== "plan", ...dist };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const plan = buildPlan(process.env);
  console.log(`Cloudflare Pages ${plan.mode}: project=${plan.project} branch=${plan.branch} files=${plan.files} bytes=${plan.bytes} _headers=${plan.headers} _redirects=${plan.redirects}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `branch=${plan.branch}\ndeploy=${plan.deploy}\nfiles=${plan.files}\nbytes=${plan.bytes}\n`);
  }
}
