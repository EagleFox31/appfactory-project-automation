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

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a valid HTTPS origin.`);
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${label} must not contain a path.`);
  }

  return url.origin;
}
function readConfig(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeConfig(path, config) {
  fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function prepareDeploymentConfig(template, { publicBaseUrl, allowedJobWorkflowRefs }) {
  if (typeof allowedJobWorkflowRefs !== 'string' || !allowedJobWorkflowRefs.trim()) {
    throw new Error('ALLOWED_JOB_WORKFLOW_REFS must contain at least one exact workflow identity.');
  }

  const config = structuredClone(template);
  config.vars = {
    ...config.vars,
    PUBLIC_BASE_URL: normalizeHttpsOrigin(publicBaseUrl),
    ALLOWED_JOB_WORKFLOW_REFS: allowedJobWorkflowRefs.trim()
  };
  delete config.d1_databases;
  return config;
}

export function bindD1Database(config, databaseId) {
  if (typeof databaseId !== 'string' || !databaseId.trim() || databaseId.includes('REPLACE_')) {
    throw new Error('A real D1 database ID is required.');
  }

  return {
    ...structuredClone(config),
    d1_databases: [{
      binding: 'DB',
      database_name: DATABASE_NAME,
      database_id: databaseId.trim()
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
  return 'Usage: render-wrangler-config.mjs prepare <template> <output> | bind-d1 <config> <database-id> | set-public-base-url <config> <https-origin>';
}

function main(argv = process.argv.slice(2), env = process.env) {
  const [command, path, value] = argv;

  if (command === 'prepare' && path && value) {
    const config = prepareDeploymentConfig(readConfig(path), {
      publicBaseUrl: env.BROKER_PUBLIC_BASE_URL,
      allowedJobWorkflowRefs: env.BROKER_ALLOWED_JOB_WORKFLOW_REFS
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
