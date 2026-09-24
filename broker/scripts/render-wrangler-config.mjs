import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DATABASE_NAME = 'appfactory-project-token-broker';

function normalizeHttpsOrigin(value, label = 'PUBLIC_BASE_URL') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin.`);
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error(`${label} must be a valid HTTPS origin without a path.`);
  }

  return url.origin;
}

function normalizeWorkflowRefs(value, label) {
  const refs = String(value ?? '')
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!refs.length) {
    throw new Error(`${label} must contain at least one workflow identity.`);
  }

  for (const ref of refs) {
    if (!/^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^@\s]+@[^\s]+$/u.test(ref)) {
      throw new Error(`${label} contains an invalid workflow identity: ${ref}`);
    }
  }

  return [...new Set(refs)].join('\n');
}

function readConfig(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeConfig(path, config) {
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function prepareDeploymentConfig(template, {
  publicBaseUrl,
  allowedJobWorkflowRefs,
  delegatedCallerWorkflowRefs = '',
  githubAuthProvider = 'oauth-app'
}) {
  if (!['oauth-app', 'github-app'].includes(githubAuthProvider)) {
    throw new Error('GITHUB_AUTH_PROVIDER must be oauth-app or github-app.');
  }

  const config = structuredClone(template);
  config.vars = {
    ...config.vars,
    GITHUB_AUTH_PROVIDER: githubAuthProvider,
    PUBLIC_BASE_URL: normalizeHttpsOrigin(publicBaseUrl),
    ALLOWED_JOB_WORKFLOW_REFS: normalizeWorkflowRefs(
      allowedJobWorkflowRefs,
      'ALLOWED_JOB_WORKFLOW_REFS'
    ),
    DELEGATED_CALLER_WORKFLOW_REFS: String(delegatedCallerWorkflowRefs ?? '').trim()
  };

  delete config.d1_databases;
  return config;
}

export function bindD1Database(config, databaseId) {
  const id = String(databaseId ?? '').trim();
  if (!id || id.includes('REPLACE_')) {
    throw new Error('A real D1 database ID is required.');
  }

  return {
    ...structuredClone(config),
    d1_databases: [{
      binding: 'DB',
      database_name: DATABASE_NAME,
      database_id: id,
      migrations_dir: 'migrations'
    }]
  };
}

export function setPublicBaseUrl(config, publicBaseUrl) {
  return {
    ...structuredClone(config),
    vars: {
      ...config.vars,
      PUBLIC_BASE_URL: normalizeHttpsOrigin(publicBaseUrl)
    }
  };
}

function usage() {
  return [
    'Usage:',
    '  render-wrangler-config.mjs prepare <template> <output>',
    '  render-wrangler-config.mjs bind-d1 <config> <database-id>',
    '  render-wrangler-config.mjs set-public-base-url <config> <https-origin>'
  ].join('\n');
}

function main(argv = process.argv.slice(2), env = process.env) {
  const [command, path, value] = argv;

  if (command === 'prepare' && path && value) {
    const config = prepareDeploymentConfig(readConfig(path), {
      publicBaseUrl: env.BROKER_PUBLIC_BASE_URL,
      allowedJobWorkflowRefs: env.BROKER_ALLOWED_JOB_WORKFLOW_REFS,
      delegatedCallerWorkflowRefs: env.BROKER_DELEGATED_CALLER_WORKFLOW_REFS,
      githubAuthProvider: env.BROKER_GITHUB_AUTH_PROVIDER || 'oauth-app'
    });
    writeConfig(value, config);
    return;
  }

  if (command === 'bind-d1' && path && value) {
    writeConfig(path, bindD1Database(readConfig(path), value));
    return;
  }

  if (command === 'set-public-base-url' && path && value) {
    writeConfig(path, setPublicBaseUrl(readConfig(path), value));
    return;
  }

  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
