#!/usr/bin/env node
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateContainerConfig, validateSourceSha } from '../../src/deployment/contract.mjs';
import { validateTargetSpec } from '../../src/deployment/ssm-preflight.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const sha = validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const eventName = process.env.GITHUB_EVENT_NAME;
if (eventName !== 'workflow_dispatch') throw new Error('SSM preflight must be manually dispatched');
const configuration = process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json';
const raw = JSON.parse(await readFile(resolve(configuration), 'utf8'));
const validated = validateContainerConfig(raw, { repository, root: process.cwd() });
const spec = validateTargetSpec(validated, repository, sha, process.env.APPFACTORY_ENVIRONMENT);
if (process.env.GITHUB_REF !== 'refs/heads/' + validated.releaseBranch)
  throw new Error('SSM preflight must run on the configured default/release branch');
const summary = [
  '### AWS SSM target preflight',
  'Application: ' + spec.projectId + ' / ' + spec.environment,
  'Target: ' + spec.instanceId + ' in ' + spec.region,
  'Expected AWS account: ' + spec.account,
  'Source commit: ' + spec.sha,
  '**Mode: read-only inspection. No SendCommand or deployment.**',
  ''
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
const out = process.env.GITHUB_OUTPUT;
if (out) await appendFile(out, [
  'role_arn=' + spec.roleArn,
  'account=' + spec.account,
  'region=' + spec.region,
  'instance_id=' + spec.instanceId,
  'environment=' + spec.environment,
  'project_id=' + spec.projectId,
  'repository=' + spec.repository,
  'source_sha=' + spec.sha,
  ''
].join('\n'));
