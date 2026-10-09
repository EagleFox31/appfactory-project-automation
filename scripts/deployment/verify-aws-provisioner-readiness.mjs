#!/usr/bin/env node
// Read AWS snapshots written by a protected OIDC workflow. Never mutate AWS.
import {readFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {evaluateAwsProvisionerReadiness} from '../../src/deployment/aws-provisioner-readiness.mjs';

if(process.env.GITHUB_ACTIONS!=='true' || process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')
  throw new Error('Provisioner readiness is allowed only from manual GitHub dispatch');
if(process.env.GITHUB_REF!=='refs/heads/main')
  throw new Error('Provisioner readiness requires main branch');
const temp=process.env.RUNNER_TEMP;
if(!temp)throw new Error('RUNNER_TEMP is required');
const names=[
  'identity','runner-role','service-role','cloudformation-simulation',
  'passrole-simulation','tenant-iam-simulation'
];
const snapshots=await Promise.all(names.map(name=>
  readFile(join(temp,'aws-onboarding-'+name+'.json'),'utf8').then(JSON.parse)
));
const [sts,runnerRole,serviceRole,cloudFormationSimulation,
  passRoleSimulation,iamRoleSimulation]=snapshots;
const result=evaluateAwsProvisionerReadiness({
  expectedAccount:process.env.EXPECTED_AWS_ACCOUNT,
  targetRepository:process.env.TARGET_REPOSITORY,
  stackArn:process.env.TARGET_STACK_ARN,
  targetRoleArn:process.env.TARGET_ROLE_ARN,
  runnerRoleArn:process.env.RUNNER_ROLE_ARN,
  serviceRoleArn:process.env.CFN_SERVICE_ROLE_ARN,
  sts,runnerRole,serviceRole,
  cloudFormationSimulation,passRoleSimulation,iamRoleSimulation
});
const summary=[
  '### AWS delegated provisioning capability assessment (read-only)',
  '- Target repository: '+result.repository,
  '- AWS account: '+result.account.slice(0,4)+'********',
  '- Staging stack namespace: '+result.stackArn.split(':stack/')[1],
  '- All three scoped IAM simulation groups: allowed (advisory)',
  '- Separate runner and CloudFormation service roles verified',
  '- **NO infrastructure created, no IAM role changed, no SSM executed.**',
  '- **Simulator approval is not sufficient to authorize execution.**',
  '- Require separate cost evaluation, permissions boundary, protected approval and actual AWS account checks before provisioning.',
  ''
].join('\n');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
