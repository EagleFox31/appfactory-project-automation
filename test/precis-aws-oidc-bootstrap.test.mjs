import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const yml=readFileSync(new URL('../infra/aws/blueprints/precis-staging-oidc-cfn-bootstrap.yml',import.meta.url),'utf8');
test('Précis bootstrap reuses Atelier OIDC/CFN design without touching Atelier resources',()=>{
  assert.match(yml,/token\.actions\.githubusercontent\.com/);
  assert.match(yml,/sts:AssumeRoleWithWebIdentity/);
  assert.match(yml,/repo:EagleFox31@86088743\/Pr-cis-Translation@1411758415:environment:staging/);
  assert.match(yml,/Service: cloudformation\.amazonaws\.com/);
  assert.match(yml,/precis-translation-staging-github-deployer/);
  assert.match(yml,/precis-translation-staging-cfn-execution/);
  assert.doesNotMatch(yml,/atelier-maitre-prod|atelier-maitre-github-actions-role|PowerUserAccess|AdministratorAccess/);
});
test('AWS role cannot deploy outside Paris or Précis stack via GitHub CloudFormation',()=>{
  assert.match(yml,/aws:RequestedRegion': eu-west-3/);
  assert.match(yml,/cloudformation:CreateChangeSet/);
  assert.match(yml,/cloudformation:ExecuteChangeSet/);
  assert.match(yml,/stack\/precis-translation-staging-app/);
  assert.match(yml,/AppFactoryEnvironment/);
  assert.match(yml,/precis-translation-staging-ttl/);
});
test('isolated instance and cleanup permissions boundaries are explicit',()=>{
  assert.match(yml,/appfactory-staging-ssm-instance-boundary/);
  assert.match(yml,/appfactory-staging-ttl-scheduler-boundary/);
  assert.match(yml,/ssm:GetParameter/);
  const boundary = yml.slice(yml.indexOf('Sid: SsmInstanceAgentCore'),
    yml.indexOf('Sid: ReadOnlyOwnRuntimeSecret'));
  assert.doesNotMatch(boundary,/ssm:GetParameters?/);
  const exact = yml.slice(yml.indexOf('Sid: ReadOnlyOwnRuntimeSecret'),
    yml.indexOf('StagingExpiryBoundary:'));
  assert.match(exact,/ssm:GetParameters/);
  assert.match(exact,/parameter\/precis-translation\/staging\/env/);
  assert.match(yml,/parameter\/precis-translation\/staging\/env/);
  assert.match(yml,/cloudformation:DeleteStack/);
  assert.doesNotMatch(yml,/ssm:PutParameter|ssm:DeleteParameter|kms:ScheduleKeyDeletion|iam:CreateUser|iam:CreateAccessKey/);
});
