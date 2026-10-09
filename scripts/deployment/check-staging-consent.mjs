#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateContainerConfig, validateSourceSha } from '../../src/deployment/contract.mjs';
import { requireStagingConsent } from '../../src/deployment/ssm-gateway.mjs';

if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
  throw new Error('Remote rollout can only be manually dispatched');
if (process.env.APPFACTORY_PROVENANCE_VERIFIED !== 'true'
    || process.env.APPFACTORY_EXECUTE !== 'true')
  throw new Error('Successful release verification and explicit execute=true are required');
const repository=process.env.GITHUB_REPOSITORY;
const sourceSha=validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const config=validateContainerConfig(
  JSON.parse(await readFile(process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json','utf8')),
  {repository,root:process.cwd()}
);
if (process.env.GITHUB_REF !== 'refs/heads/'+config.releaseBranch)
  throw new Error('Rollout must start on the trusted release branch');
requireStagingConsent({
  config,sourceSha,requestedEnvironment:process.env.APPFACTORY_ENVIRONMENT,
  confirmation:process.env.APPFACTORY_APPROVAL
});
console.log('Explicit tenant/source-SHA staging consent validated before AWS authentication.');
