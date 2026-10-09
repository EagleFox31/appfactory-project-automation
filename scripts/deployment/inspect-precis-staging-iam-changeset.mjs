#!/usr/bin/env node
// This gate runs after CloudFormation has created (but NOT executed) a change set.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const deny=(s)=>{throw new Error('Refuse AWS IAM change set: '+s);};
if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch' || process.env.GITHUB_REF!=='refs/heads/main')
  deny('requires manual dispatch on main');
if(!process.env.RUNNER_TEMP || !process.env.CHANGESET || !process.env.GITHUB_RUN_ID)
  deny('missing trusted runner metadata');
if(process.env.CHANGESET!=='appfactory-precis-staging-'+process.env.GITHUB_RUN_ID)
  deny('change-set name does not match current run');
const data=JSON.parse(readFileSync(join(process.env.RUNNER_TEMP,'appfactory-precis-changeset.json'),'utf8'));
if(data.StackName!=='precis-staging-iam-readonly')
  deny('different stack');
if(data.ChangeSetName!==process.env.CHANGESET)
  deny('different change set');
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
