#!/usr/bin/env node
import { readFile, writeFile, appendFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateSourceSha, validateContainerConfig } from '../../src/deployment/contract.mjs';
import { checkTargetInspection, validateTargetSpec } from '../../src/deployment/ssm-preflight.mjs';
import { buildRolloutPayload, packageRemoteRollout } from '../../src/deployment/ssm-gateway.mjs';

if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
  throw new Error('SSM rollout must be manually dispatched');
if (process.env.APPFACTORY_PROVENANCE_VERIFIED !== 'true')
  throw new Error('Verified GitHub release provenance is required before SSM');
if (process.env.APPFACTORY_EXECUTE !== 'true')
  throw new Error('A real, explicitly requested staging rollout is required');
const repository=process.env.GITHUB_REPOSITORY;
const sourceSha=validateSourceSha(process.env.APPFACTORY_SOURCE_SHA);
const config=validateContainerConfig(JSON.parse(await readFile(
  process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json','utf8')),
  {repository,root:process.cwd()});
if (process.env.GITHUB_REF !== 'refs/heads/'+config.releaseBranch)
  throw new Error('SSM rollout must execute on the reviewed release branch');
const temp=process.env.RUNNER_TEMP;
if(!temp)throw new Error('Runner temporary directory missing');
const artifactText=await readFile('appfactory-release-manifest.json','utf8');
const checksum=(await readFile('appfactory-release-manifest.json.sha256','utf8')).trim();
if(checksum!==createHash('sha256').update(artifactText).digest('hex')
    +'  appfactory-release-manifest.json')throw new Error('Manifest checksum mismatch');
const [identity,instances,ssm]=await Promise.all(
  ['aws-sts.json','aws-ec2.json','aws-ssm.json']
    .map(name=>readFile(join(temp,name),'utf8').then(JSON.parse))
);
const expected=validateTargetSpec(config,repository,sourceSha,process.env.APPFACTORY_ENVIRONMENT);
const inspection=checkTargetInspection(expected,{identity,instances,ssm});
const manifest=JSON.parse(artifactText);
const payload=buildRolloutPayload({
  config,manifest,repository,sourceSha,inspection,
  requestedEnvironment:process.env.APPFACTORY_ENVIRONMENT,
  confirmation:process.env.APPFACTORY_APPROVAL
});
const hostScript=await readFile('.appfactory/scripts/deployment/ssm-host-rollout.py','utf8');
const command=packageRemoteRollout({hostScript,payload});
const commandPath=join(temp,'appfactory-ssm-command.json');
await writeFile(commandPath,JSON.stringify(command),{flag:'wx',mode:0o600});
await chmod(commandPath,0o600);
const summary=[
  '### Verified staging SSM rollout command prepared',
  '- Application: '+config.projectId+'/'+config.environment,
  '- Exact instance: '+expected.instanceId,
  '- Source SHA: '+sourceSha,
  '- OCI digest services: '+Object.keys(payload.imageServices).join(', '),
  '- Predeploy hook and backup evidence mandatory on host',
  '- Only the approved instance may receive this command.',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,
  'command_file='+commandPath+'\ninstance_id='+expected.instanceId+'\n');
