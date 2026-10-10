import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('../infra/aws/blueprints/reusable-compose-staging-host.yml',import.meta.url),'utf8');
const consumer=JSON.parse(readFileSync(new URL('../infra/aws/consumers/precis-staging.json',import.meta.url),'utf8'));
test('reusable host IaC avoids per-project or production hardcoded resource names',()=>{
  assert.match(template,/ProjectSlug:/);
  assert.match(template,/Environment:/);
  assert.match(template,/AllowedValues:\s+- staging/);
  assert.match(template,/AWS::EC2::Instance/);
  assert.match(template,/m7i-flex.large/);
  assert.doesNotMatch(template,/t3.medium/);
  assert.match(template,/AWS::EC2::SecurityGroup/);
  assert.match(template,/AWS::IAM::Role/);
  assert.match(template,/AWS::IAM::InstanceProfile/);
  assert.doesNotMatch(template,/atelier-maitre|precis-translation|EagleFox31|tiffany|iam:\*/i);
});
test('staging host is bounded, encrypted, SSM-only and has no inbound ports',()=>{
  assert.match(template,/PermissionsBoundary: !Ref InstanceRoleBoundaryArn/);
  assert.match(template,/AmazonSSMManagedInstanceCore/);
  assert.match(template,/HttpTokens: required/);
  assert.match(template,/VolumeType: gp3/);
  assert.match(template,/Encrypted: true/);
  assert.match(template,/FromPort: 443/);
  assert.match(template,/ToPort: 443/);
  assert.doesNotMatch(template,/SecurityGroupIngress:|FromPort: 22|FromPort: 5432|CidrIp: 0\.0\.0\.0\/0[\s\S]*FromPort: 80/);
});
test('host blueprint never embeds application or production secrets',()=>{
  assert.doesNotMatch(template,/DEEPSEEK_API_KEY|POSTGRES_PASSWORD|JWT_SECRET|CAMPAY_PASSWORD|github_pat_|ghp_/i);
  assert.match(template,/No credentials, application data or deployment in user data/);
});
test('precis consumer is explicitly plan-only until costs and authorizations are verified',()=>{
  assert.equal(consumer.project,'precis-translation');
  assert.equal(consumer.environment,'staging');
  assert.equal(consumer.repository,'EagleFox31/Pr-cis-Translation');
  assert.equal(consumer.lifecycle,'PLAN_ONLY');
  assert.equal(consumer.host.instanceType,'m7i-flex.large');
  assert.equal(consumer.host.rootVolumeGiB,40);
  assert.deepEqual(consumer.host.inboundTcpPorts,[]);
  assert.equal(consumer.application.databaseService,'db');
  assert.equal(consumer.application.translationVolume,'translations');
  assert.equal(consumer.application.postgresVolume,'pgdata');
  assert.equal(consumer.safety.safeToApply,false);
  assert.equal(consumer.safety.awsStackAuthorizedForApply,false);
  assert.equal(consumer.safety.costEstimateVerified,false);
  assert.equal(consumer.safety.automaticTTLTeardownImplemented,false);
});
