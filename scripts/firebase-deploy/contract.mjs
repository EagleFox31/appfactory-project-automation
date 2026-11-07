// Contract for the reusable Firebase deployment (Hosting, Firestore rules and indexes) authenticated with
// GitHub OIDC + Workload Identity Federation. It validates consumer inputs, the firebase.json hosting
// configuration, the built public directory and the production guard before any Google credential exists.
// Pure functions are exported for tests; the CLI prints a plan and GitHub outputs. Mode "plan" needs no GCP access.
import { readdirSync, statSync, existsSync, appendFileSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const MODES = new Set(["plan", "preview", "production"]);
export const TARGETS = new Set(["hosting", "firestore:rules", "firestore:indexes"]);
export const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const WIF_PROVIDER_RE = /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
export const SERVICE_ACCOUNT_RE = /^[a-z][a-z0-9-]{4,28}@[a-z][a-z0-9-]{4,28}\.iam\.gserviceaccount\.com$/;
export const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const CHANNEL_MAX = 63;

// Versions whose breakage is recorded in docs/engineering/lessons-learned.md. Rejected before any install.
export const KNOWN_BROKEN = {
  firebaseTools: { "15.22.2": "Workload Identity credentials rejected (regression fixed in 15.22.3)" },
  node: { "22.23.0": "firebase-tools crashes at startup", "24.17.0": "firebase-tools crashes at startup" },
};

// File names and contents that must never be published from a Hosting public directory.
export const CREDENTIAL_FILE_RE = /^(gha-creds-.*\.json|.*service[-_]?account.*\.json|\.env(\..+)?|application_default_credentials\.json)$/i;
const CREDENTIAL_CONTENT_RE = /"type"\s*:\s*"(service_account|external_account|authorized_user)"|"private_key"\s*:|"refresh_token"\s*:/;
const CONTENT_SCAN_MAX_BYTES = 256 * 1024;

export function assertMode(mode) {
  if (!MODES.has(mode)) throw new Error(`mode "${mode}" must be one of ${[...MODES].join(", ")}`);
  return mode;
}

export function assertProjectId(id) {
  if (!PROJECT_ID_RE.test(String(id || ""))) {
    throw new Error(`firebase_project_id "${id}" must be a Google Cloud project id (6-30 lowercase letters, digits and hyphens, starting with a letter)`);
  }
  return id;
}

export function parseTargets(raw) {
  const list = String(raw || "hosting").split(",").map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) throw new Error("targets is empty: pass at least one of hosting, firestore:rules, firestore:indexes");
  const unknown = list.filter((t) => !TARGETS.has(t));
  if (unknown.length) throw new Error(`targets contains unknown entries ${unknown.join(", ")}: allowed ${[...TARGETS].join(", ")}`);
  return [...new Set(list)];
}

export function assertExactVersion(name, value, broken = {}) {
  if (!EXACT_SEMVER_RE.test(String(value || ""))) throw new Error(`${name} "${value}" must be an exact version (x.y.z): ranges and tags are not reproducible`);
  if (broken[value]) throw new Error(`${name} ${value} is known broken: ${broken[value]} (see docs/engineering/lessons-learned.md)`);
  return value;
}

// Identity inputs are validated by shape only: the contract never contacts Google and never reads a token.
export function assertIdentity({ mode, provider, serviceAccount }) {
  if (mode === "plan") return { provider: provider || "", serviceAccount: serviceAccount || "" };
  if (!WIF_PROVIDER_RE.test(String(provider || ""))) {
    throw new Error(`workload_identity_provider "${provider}" must look like projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`);
  }
  if (!SERVICE_ACCOUNT_RE.test(String(serviceAccount || ""))) {
    throw new Error(`service_account "${serviceAccount}" must be a service account email (<name>@<project>.iam.gserviceaccount.com)`);
  }
  return { provider, serviceAccount };
}

// Preview channel: derived from the branch name unless given; never the live channel; Firebase-safe slug.
export function resolveChannel({ mode, channel, refName }) {
  if (mode !== "preview") return "live";
  const source = channel || refName || "preview";
  const safe = String(source).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, CHANNEL_MAX).replace(/-+$/g, "");
  if (!safe) throw new Error(`preview_channel "${source}" is empty once normalized to [a-z0-9-]`);
  if (safe === "live") throw new Error('preview_channel "live" is the production channel: previews must use another channel id');
  return safe;
}

// Production is allowed only from a branch push/dispatch on the production branch of the consumer itself.
export function assertProductionGuard({ mode, eventName, ref, productionBranch, repository, headRepository }) {
  if (mode !== "production") return { allowed: mode !== "plan", reason: mode };
  if (!productionBranch) throw new Error("production_branch is empty: pass it or let the consumer's default branch be discovered");
  const forbiddenEvents = new Set(["pull_request", "pull_request_target", "pull_request_review", "pull_request_review_comment", "issue_comment", "workflow_run"]);
  if (forbiddenEvents.has(eventName)) throw new Error(`production deployment refused for event "${eventName}": only push, workflow_dispatch, schedule and release on the production branch may deploy`);
  const expected = `refs/heads/${productionBranch}`;
  if (ref !== expected) throw new Error(`production deployment refused for ref "${ref}": expected ${expected}`);
  if (headRepository && repository && headRepository !== repository) throw new Error(`production deployment refused: head repository "${headRepository}" is not "${repository}" (fork)`);
  return { allowed: true, reason: `${eventName} on ${expected}` };
}

export function readHostingConfig(siteDir, hostingTarget = "") {
  const file = path.join(siteDir, "firebase.json");
  if (!existsSync(file)) throw new Error(`firebase.json not found in site_dir "${siteDir}"`);
  let config;
  try { config = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`firebase.json is not valid JSON: ${e.message}`); }
  let hosting = config.hosting;
  if (Array.isArray(hosting)) {
    if (!hostingTarget && hosting.length === 1) hosting = hosting[0];
    else {
      hosting = hosting.find((h) => h && (h.target === hostingTarget || h.site === hostingTarget));
      if (!hosting) throw new Error(`firebase.json hosting is an array: pass hosting_target matching one "target" or "site" (${config.hosting.map((h) => h?.target || h?.site).join(", ")})`);
    }
  }
  return { config, hosting: hosting || null };
}

function ignoreCovers(ignore, needle) {
  return (Array.isArray(ignore) ? ignore : []).some((p) => typeof p === "string" && p.includes(needle));
}

// Scans the directory Hosting would upload. Any credential-looking file fails the contract, whatever the mode:
// a Workload Identity credentials file published on a website is a full compromise of the service account.
export function inspectPublicDir({ siteDir, hosting, workspace }) {
  if (!hosting) throw new Error('firebase.json has no "hosting" entry: target hosting needs one');
  const publicRel = hosting.public ?? "public";
  const publicDir = path.resolve(siteDir, publicRel);
  if (!existsSync(publicDir) || !statSync(publicDir).isDirectory()) throw new Error(`hosting.public "${publicRel}" is not a directory: run the build first`);
  const root = realpathSync(workspace || siteDir);
  const publicReal = realpathSync(publicDir);
  const publishesCheckout = publicReal === root || root.startsWith(publicReal + path.sep);
  const problems = [];
  let files = 0, bytes = 0, index = false;
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!(publishesCheckout && (e.name === ".git" || e.name === "node_modules"))) walk(p, r); continue; }
      if (!e.isFile()) continue;
      files += 1;
      const size = statSync(p).size;
      bytes += size;
      if (!rel && e.name === "index.html") index = true;
      if (CREDENTIAL_FILE_RE.test(e.name)) { problems.push(r); continue; }
      if (/\.json$/i.test(e.name) && size <= CONTENT_SCAN_MAX_BYTES && CREDENTIAL_CONTENT_RE.test(readFileSync(p, "utf8"))) problems.push(r);
    }
  };
  walk(publicDir, "");
  if (problems.length) {
    throw new Error(`credential-looking files found in hosting.public "${publicRel}": ${problems.join(", ")}. Remove them; the deployment contract refuses to publish a directory that could expose a credential`);
  }
  if (!index) throw new Error(`hosting.public "${publicRel}" has no index.html at its root`);
  const warnings = [];
  const ignore = hosting.ignore;
  if (publishesCheckout) {
    if (!ignoreCovers(ignore, "gha-creds")) {
      throw new Error('hosting.public is the repository checkout: hosting.ignore must contain "**/gha-creds-*.json" so a credentials file can never be uploaded (defense in depth; the workflow also writes credentials outside the workspace)');
    }
    if (!ignoreCovers(ignore, "**/.*")) throw new Error('hosting.public is the repository checkout: hosting.ignore must contain "**/.*" (dotfiles, .git, .github) ');
    if (!ignoreCovers(ignore, "node_modules")) warnings.push('hosting.ignore does not exclude node_modules');
  } else if (!ignoreCovers(ignore, "gha-creds")) {
    warnings.push('hosting.ignore does not contain "**/gha-creds-*.json" (recommended defense in depth)');
  }
  return { publicDir, publicRel, publishesCheckout, files, bytes, warnings };
}

export function inspectFirestore({ siteDir, config, targets }) {
  const wanted = targets.filter((t) => t.startsWith("firestore:"));
  if (!wanted.length) return { rules: "", indexes: "" };
  const fs = Array.isArray(config.firestore) ? config.firestore[0] : config.firestore;
  if (!fs) throw new Error(`firebase.json has no "firestore" entry: targets ${wanted.join(", ")} need one`);
  const out = { rules: "", indexes: "" };
  for (const t of wanted) {
    const key = t.split(":")[1];
    const rel = fs[key];
    if (!rel) throw new Error(`firebase.json firestore.${key} is not set: target ${t} needs it`);
    if (!existsSync(path.join(siteDir, rel))) throw new Error(`firestore.${key} file "${rel}" not found in site_dir`);
    out[key] = rel;
  }
  return out;
}

export function assertCommitConsistency({ expectedSha, headSha }) {
  if (expectedSha && !SHA_RE.test(expectedSha)) return { pinned: false };
  if (expectedSha && headSha && expectedSha !== headSha) throw new Error(`checkout_ref ${expectedSha} does not match the checked out commit ${headSha}`);
  return { pinned: Boolean(expectedSha) };
}

export function assertCredentialsDir({ credentialsDir, workspace, publicDir }) {
  if (!credentialsDir) throw new Error("credentials_dir is empty");
  const dir = path.resolve(credentialsDir);
  for (const [name, inside] of [["workspace", workspace], ["hosting.public", publicDir]]) {
    if (!inside) continue;
    const base = path.resolve(inside);
    if (dir === base || dir.startsWith(base + path.sep)) throw new Error(`credentials_dir "${dir}" is inside the ${name} "${base}": credentials must be written outside anything that is built or published`);
  }
  return dir;
}

export function buildPlan(env) {
  const mode = assertMode(env.FIREBASE_MODE);
  const project = assertProjectId(env.FIREBASE_PROJECT_ID);
  const targets = parseTargets(env.FIREBASE_TARGETS);
  const toolsVersion = assertExactVersion("firebase_tools_version", env.FIREBASE_TOOLS_VERSION, KNOWN_BROKEN.firebaseTools);
  const nodeVersion = assertExactVersion("node_version", env.FIREBASE_NODE_VERSION, KNOWN_BROKEN.node);
  const identity = assertIdentity({ mode, provider: env.FIREBASE_WORKLOAD_IDENTITY_PROVIDER, serviceAccount: env.FIREBASE_SERVICE_ACCOUNT });
  const channel = resolveChannel({ mode, channel: env.FIREBASE_PREVIEW_CHANNEL, refName: env.FIREBASE_REF_NAME });
  if (mode === "preview" && targets.some((t) => t.startsWith("firestore:"))) {
    throw new Error("preview mode only supports the hosting target: Firestore rules and indexes have no preview channel and would change production");
  }
  const guard = assertProductionGuard({
    mode, eventName: env.FIREBASE_EVENT_NAME, ref: env.FIREBASE_REF, productionBranch: env.FIREBASE_PRODUCTION_BRANCH,
    repository: env.FIREBASE_REPOSITORY, headRepository: env.FIREBASE_HEAD_REPOSITORY,
  });
  const siteDir = path.resolve(env.FIREBASE_SITE_DIR || ".");
  const { config, hosting } = readHostingConfig(siteDir, env.FIREBASE_HOSTING_TARGET || "");
  const site = targets.includes("hosting") ? inspectPublicDir({ siteDir, hosting, workspace: env.FIREBASE_WORKSPACE }) : { publicDir: "", publicRel: "", publishesCheckout: false, files: 0, bytes: 0, warnings: [] };
  const firestore = inspectFirestore({ siteDir, config, targets });
  const commit = assertCommitConsistency({ expectedSha: env.FIREBASE_CHECKOUT_REF, headSha: env.FIREBASE_HEAD_SHA });
  const credentialsDir = mode === "plan" ? "" : assertCredentialsDir({ credentialsDir: env.FIREBASE_CREDENTIALS_DIR, workspace: env.FIREBASE_WORKSPACE, publicDir: site.publicDir });
  const only = targets.includes("hosting") && env.FIREBASE_HOSTING_TARGET ? targets.map((t) => (t === "hosting" ? `hosting:${env.FIREBASE_HOSTING_TARGET}` : t)).join(",") : targets.join(",");
  return {
    mode, project, targets, only, channel, deploy: mode !== "plan", toolsVersion, nodeVersion, identity, guard, siteDir, credentialsDir,
    hostingTarget: env.FIREBASE_HOSTING_TARGET || "", ...site, firestore, commit,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const plan = buildPlan(process.env);
  console.log(`Firebase ${plan.mode}: project=${plan.project} only=${plan.only} channel=${plan.channel} public=${plan.publicRel || "-"} files=${plan.files} bytes=${plan.bytes} guard=${plan.guard.reason}`);
  for (const w of plan.warnings) console.log(`::warning::${w}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `deploy=${plan.deploy}`, `only=${plan.only}`, `channel=${plan.channel}`, `files=${plan.files}`, `bytes=${plan.bytes}`,
      `public_dir=${plan.publicDir}`, `credentials_dir=${plan.credentialsDir}`, `firebase_tools_version=${plan.toolsVersion}`, "",
    ].join("\n"));
  }
}
