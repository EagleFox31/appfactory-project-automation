#!/usr/bin/env node
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateSourceSha } from '../../src/deployment/contract.mjs';
import { fetchGitHubWorkflowRun, verifyReleaseProvenance } from '../../src/deployment/release-provenance.mjs';
import { validateContainerConfig } from '../../src/deployment/contract.mjs';
import { assembleVerifiedHostPayload } from '../../src/deployment/verified-host-payload.mjs';

if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')
  throw new Error('Host rollout payload may be prepared only from a manual dispatch');
const repository=process.env.GITHUB_REPOSITORY;
const sourceSha=validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const environment=process.env.APPFACTORY_ENVIRONMENT;
const root=process.cwd();
const rawConfig=JSON.parse(await readFile(process.env.APPFACTORY_DEPLOY_CONFIG
  || '.github/appfactory-deploy.json','utf8'));
const config=validateContainerConfig(rawConfig,{repository,root});
if(process.env.GITHUB_REF!=='refs/heads/'+config.releaseBranch)
  throw new Error('Host payload creation requires the protected release branch');
if(environment!==config.environment)
  throw new Error('Host payload requested for wrong environment');
const manifestBytes=await readFile('appfactory-release-manifest.json','utf8');
const actualChecksum=(await readFile('appfactory-release-manifest.json.sha256','utf8')).trim();
const expectedChecksum=createHash('sha256').update(manifestBytes).digest('hex')
  +'  appfactory-release-manifest.json';
if(actualChecksum!==expectedChecksum)
  throw new Error('Downloaded manifest checksum mismatch');
const manifest=JSON.parse(manifestBytes);
const buildRunId=Number(process.env.APPFACTORY_BUILD_RUN_ID);
const provenance=await verifyReleaseProvenance({
  manifest,config,repository,sourceSha,buildRunId,
  ciWorkflowPath:process.env.APPFACTORY_CI_WORKFLOW,
  publishWorkflowPath:process.env.APPFACTORY_PUBLISH_WORKFLOW,
  getRun: id=>fetchGitHubWorkflowRun({
    repository,runId:id,token:process.env.GITHUB_TOKEN
  })
});
const temp=process.env.RUNNER_TEMP;
if(!temp)throw new Error('Runner temp directory not set');
const [awsIdentity,awsInstances,awsSsm]=await Promise.all([
  'aws-sts.json','aws-ec2.json','aws-ssm.json'
].map(filename=>readFile(resolve(temp,filename),'utf8').then(JSON.parse)));
const payload=assembleVerifiedHostPayload({
  rawConfig,repository,sourceSha,requestedEnvironment:environment,
  manifest,provenance,awsIdentity,awsInstances,awsSsm,root
});
const output='appfactory-host-rollout-payload.json';
await writeFile(output,JSON.stringify(payload,null,2)+'\n',{flag:'wx',mode:0o600});
const summary=[
  '### Verified SSM host payload — **not executed**',
  '- Application: '+payload.projectId+'/'+payload.environment,
  '- Source SHA: '+sourceSha,
  '- GHCR build run: '+buildRunId,
  '- Target SSM instance: '+config.deployment.instanceId,
  '- Images: '+Object.keys(payload.images).join(', '),
  '- Compose service mapping: '+Object.entries(payload.imageServices).map(([a,b])=>a+' → '+b).join(', '),
  '- Requires host-side quiescence, backups and approved initial rollback state',
  '- **Read-only result:** no AWS SendCommand, Docker mutation or cloud provisioning.',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
