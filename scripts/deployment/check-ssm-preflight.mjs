#!/usr/bin/env node
import { readFile, appendFile } from 'node:fs/promises';
import { validateTargetSpec, checkTargetInspection, assertImageArchitecture } from '../../src/deployment/ssm-preflight.mjs';
import { validateContainerConfig } from '../../src/deployment/contract.mjs';
const config = validateContainerConfig(
  JSON.parse(await readFile(process.env.APPFACTORY_DEPLOY_CONFIG || '.github/appfactory-deploy.json','utf8')),
  {repository:process.env.GITHUB_REPOSITORY,root:process.cwd()}
);
const spec = validateTargetSpec(config,process.env.GITHUB_REPOSITORY,
  process.env.APPFACTORY_SOURCE_SHA, process.env.APPFACTORY_ENVIRONMENT);
const [identity,instances,ssm] = await Promise.all([
  'aws-sts.json','aws-ec2.json','aws-ssm.json'
].map(name => readFile(process.env.RUNNER_TEMP+'/'+name,'utf8').then(JSON.parse)));
const inspected = checkTargetInspection(spec,{identity,instances,ssm});
assertImageArchitecture(config,inspected);
const summary=[
  '### AppFactory EC2 / SSM inspection passed',
  '- Repository: '+spec.repository,
  '- Project/environment: '+spec.projectId+' / '+spec.environment,
  '- Instance: '+inspected.instanceId,
  '- EC2 architecture: '+inspected.architecture,
  '- SSM: '+inspected.ssm,
  '- **Read-only AWS APIs only. No production deployment or resource provisioning.**',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
