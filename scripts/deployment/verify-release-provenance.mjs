#!/usr/bin/env node
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateContainerConfig, validateSourceSha } from '../../src/deployment/contract.mjs';
import { verifyReleaseProvenance, fetchGitHubWorkflowRun }
  from '../../src/deployment/release-provenance.mjs';

if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
  throw new Error('Immutable release verification is manual-only');
const repository = process.env.GITHUB_REPOSITORY;
const sourceSha = validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const config = validateContainerConfig(JSON.parse(
  await readFile(process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json','utf8')),
  {repository,root:process.cwd()}
);
if (process.env.GITHUB_REF !== 'refs/heads/'+config.releaseBranch)
  throw new Error('Release verification must use the protected release branch');
if (process.env.APPFACTORY_ENVIRONMENT !== config.environment)
  throw new Error('Requested environment does not match the configured consumer');
const text = await readFile('appfactory-release-manifest.json','utf8');
const checksum = (await readFile('appfactory-release-manifest.json.sha256','utf8')).trim();
const expectedChecksum = createHash('sha256').update(text).digest('hex')
  +'  appfactory-release-manifest.json';
if (checksum !== expectedChecksum) throw new Error('Release artifact checksum mismatch');
const manifest = JSON.parse(text);
const buildRunId = Number(process.env.APPFACTORY_BUILD_RUN_ID);
const token = process.env.GITHUB_TOKEN;
const result = await verifyReleaseProvenance({
  manifest,config,repository,sourceSha,buildRunId,
  ciWorkflowPath:process.env.APPFACTORY_CI_WORKFLOW,
  publishWorkflowPath:process.env.APPFACTORY_PUBLISH_WORKFLOW,
  getRun: (runId) => fetchGitHubWorkflowRun({repository,runId,token})
});
const summary = [
  '### Immutable release provenance verified',
  '- Repository: '+repository,
  '- Source SHA: '+sourceSha,
  '- Environment: '+config.environment,
  '- CI run: '+result.ciRunId,
  '- Build run: '+result.buildRunId,
  ...result.manifest.images.map(i=>'- '+i.name+': '+i.ref),
  '- Verified existing GitHub Actions runs; no cloud access or deployment.',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
  'verified=true\nsource_sha='+sourceSha+'\nbuild_run_id='+buildRunId+'\n');
