#!/usr/bin/env node
// This gate runs after CloudFormation has created (but NOT executed) a change set.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const deny=(s)=>{throw new Error('Refuse AWS IAM change set: '+s);};
if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch' || process.env.GITHUB_REF!=='refs/heads/main')
  deny('requires manual dispatch on main');
if(!process.env.RUNNER_TEMP || !process.env.CHANGESET || !process.env.GITHUB_RUN_ID)
  deny('missing trusted runner metadata');
const fresh='appfactory-precis-staging-'+process.env.GITHUB_RUN_ID;
const exactResume='appfactory-precis-staging-38008163231';
if(process.env.CHANGESET!==fresh && process.env.CHANGESET!==exactResume)
  deny('change set is neither current run nor the one explicitly approved recovery');
const data=JSON.parse(readFileSync(join(process.env.RUNNER_TEMP,'appfactory-precis-changeset.json'),'utf8'));
if(data.StackName!=='precis-staging-iam-readonly')
  deny('different stack');
if(typeof data.StackId!=='string' ||
   !data.StackId.startsWith('arn:aws:cloudformation:eu-west-3:458018461157:stack/precis-staging-iam-readonly/'))
  deny('wrong account or stack ARN');
if(data.RoleARN!=='arn:aws:iam::458018461157:role/appfactory-staging-iam-cfn-execution')
  deny('unapproved CloudFormation service role');
const parameters=new Map((data.Parameters||[]).map(p=>[p.ParameterKey,p.ParameterValue]));
if(parameters.size!==2 ||
  parameters.get('GitHubOidcProviderArn')!=='arn:aws:iam::458018461157:oidc-provider/token.actions.githubusercontent.com' ||
  parameters.get('PermissionsBoundaryArn')!=='arn:aws:iam::458018461157:policy/appfactory-staging-free-plan-boundary')
  deny('CloudFormation template parameters do not match approved identity or boundary');
if(data.ChangeSetName!==process.env.CHANGESET)
  deny('different change set');
if(!Array.isArray(data.Capabilities)||!data.Capabilities.includes('CAPABILITY_NAMED_IAM'))
  deny('IAM capability acknowledgement missing');
if(data.Status!=='CREATE_COMPLETE' || data.ExecutionStatus!=='AVAILABLE')
  deny('change set is not available');
if(data.ChangeSetType && data.ChangeSetType!=='CREATE')
  deny('updates and deletes not approved');
if(!Array.isArray(data.Changes)||data.Changes.length!==1)
  deny('expected one IAM role add only');
const change=data.Changes[0]?.ResourceChange;
if(!change || change.Action!=='Add' ||
   change.LogicalResourceId!=='PrecisStagingFreePlanReadRole' ||
   change.ResourceType!=='AWS::IAM::Role' ||
   change.Replacement && change.Replacement!=='False')
  deny('unapproved resources or actions');
console.log('Single bounded Précis read-only role ADD approved for manual execution.');
