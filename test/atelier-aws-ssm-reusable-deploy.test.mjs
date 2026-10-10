import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wf=readFileSync(new URL('../.github/workflows/reusable-aws-ssm-compose-deploy.yml',import.meta.url),'utf8');
const template=readFileSync(new URL('../infra/aws/blueprints/reusable-compose-staging-host.yml',import.meta.url),'utf8');

test('Atelier OIDC/CloudFormation/SSM delivery flow now exists in AppFactory core',()=>{
  for (const token of [
    'workflow_call:', 'environment: staging',
    'aws-actions/configure-aws-credentials@v4',
    'aws cloudformation validate-template',
    'aws cloudformation deploy',
    '--no-fail-on-empty-changeset',
    'aws ssm describe-instance-information',
    'aws ssm send-command',
    'aws ssm get-command-invocation',
    'scripts/staging/aws-ssm-compose.sh'
  ]) assert.ok(wf.includes(token),'missing '+token);
});

test('tenant-bound permissions, account and explicit secret preflight precede EC2 mutation',()=>{
  const oidc=wf.indexOf('Authenticate as isolated Précis deploy role via OIDC');
  const runtime=wf.indexOf('Fail before provisioning if required staging runtime secrets are absent');
  const provision=wf.indexOf('Deploy isolated reusable staging stack');
  assert.ok(oidc>=0&&runtime>oidc&&provision>runtime);
  assert.match(wf,/--query Parameter.Value --output text/);
  assert.match(wf,/DEEPSEEK_API_KEY/);
  assert.match(wf,/FRONTEND_API_KEY/);
  assert.match(wf,/CAMPAY_ENV/);
  assert.match(wf,/accountPlanType/);
  assert.match(wf,/accountPlanRemainingCredits/);
  assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
  assert.match(wf,/github\.event_name == 'workflow_dispatch'/);
  assert.match(wf,/AWS::NoValue|./);
});

test('never use Atelier production identifiers, GitHub PAT or SSH',()=>{
  assert.doesNotMatch(wf,/atelier-maitre|atelier2026|PowerUserAccess|AWS_SECRET_ACCESS_KEY|ssh -i|ssh-keygen/);
  assert.match(wf,/\$\{PROJECT\}-staging-cfn-execution/);
  assert.match(wf,/\$\{PROJECT\}-staging-github-deployer/);
  assert.match(wf,/ref: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(template,/ReadExactStagingRuntimeEnv/);
  assert.match(template,/ssm:GetParameter/);
});

test('lifecycle and costs remain explicitly bounded',()=>{
  assert.match(wf,/ExpiresAtUtc/);
  assert.match(wf,/InstanceType=m7i-flex.large/);
  assert.match(wf,/get-account-plan-state/);
  assert.match(wf,/environment: staging/);
  assert.match(template,/AWS::Scheduler::Schedule/);
  assert.match(template,/DeleteOnTermination: true/);
  assert.doesNotMatch(wf,/delete-stack.*atelier|StackName=atelier/);
});
