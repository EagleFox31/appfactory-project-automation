import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assembleReleaseManifest } from '../src/deployment/manifest.mjs';
import { buildRolloutPayload, packageRemoteRollout, requireStagingConsent }
  from '../src/deployment/ssm-gateway.mjs';

const repository='EagleFox31/Pr-cis-Translation',sha='a'.repeat(40);
const image='ghcr.io/eaglefox31/pr-cis-translation-api';
const digest='sha256:'+'1'.repeat(64);
const config={
  projectId:'precis-translation',environment:'staging',
  composePath:'docker-compose.yml',
  images:[{name:'api',image,platforms:'linux/arm64,linux/amd64'}],
  deployment:{
    transport:'aws-ssm',region:'eu-west-3',
    roleArn:'arn:aws:iam::123456789012:role/precis-translation-staging',
    instanceId:'i-abcdef01234567890',
    ssmParameterPrefix:'/appfactory/precis-translation/staging/',
    composeProject:'precis-translation-staging',healthPath:'/health',
    serviceNames:['backend'],imageServices:{api:'backend'},
    backupKinds:['database','documents'],healthUrl:'http://127.0.0.1/health',
    runtimeEnvTarget:'backend/.env',predeployHook:'scripts/backup.sh'
  }
};
const inspection={
  instanceId:'i-abcdef01234567890',account:'123456789012',ssm:'Online',
  architecture:'linux/arm64',
  tags:{AppFactoryProject:'precis-translation',
    AppFactoryEnvironment:'staging',AppFactoryRepository:repository}
};
const manifest=assembleReleaseManifest({
  config,repository,sourceSha:sha,ciRunId:10,buildRunId:20,
  createdAt:'2026-10-09T12:00:00Z',
  receipts:[{name:'api',image,sourceSha:sha,digest}]
});
const confirmation='deploy:precis-translation:staging:'+sha;
function fixture(){
  return {config:structuredClone(config),manifest:structuredClone(manifest),
    sourceSha:sha,repository,inspection:structuredClone(inspection),
    requestedEnvironment:'staging',confirmation};
}
test('explicit staging-only consent is SHA-bound and cannot silently target production',()=>{
  const sample=fixture();
  assert.equal(requireStagingConsent(sample),true);
  for(const change of [
    s=>s.confirmation='',
    s=>s.confirmation='deploy:atelier-maitre:staging:'+sha,
    s=>s.confirmation='deploy:precis-translation:staging:'+'b'.repeat(40),
    s=>s.requestedEnvironment='prod',
    s=>s.config.environment='production'
  ]){
    const x=fixture();change(x);
    assert.throws(()=>requireStagingConsent(x));
  }
});
test('SSM payload is limited to digest-pinned tenant images and required backup policy',()=>{
  const payload=buildRolloutPayload(fixture());
  assert.equal(payload.projectId,'precis-translation');
  assert.equal(payload.composeProject,'precis-translation-staging');
  assert.equal(payload.images.api,image+'@'+digest);
  assert.deepEqual(payload.backupKinds,['database','documents']);
  assert.deepEqual(payload.imageServices,{api:'backend'});
  assert.equal(JSON.stringify(payload).includes('POSTGRES_PASSWORD'),false);
});
test('foreign EC2, mutable images, unsupported CPU and service mapping are refused',()=>{
  const changes=[
    x=>x.inspection.instanceId='i-00000000000000000',
    x=>x.inspection.tags.AppFactoryRepository='EagleFox31/atelier2026',
    x=>x.inspection.architecture='linux/ppc64le',
    x=>x.manifest.images[0].digest='sha256:'+'e'.repeat(64),
    x=>x.manifest.environment='production',
    x=>x.config.deployment.imageServices.api='postgres',
    x=>x.config.deployment.runtimeEnvTarget='backend/config.py',
    x=>x.config.deployment.predeployHook='../../evil',
    x=>x.config.deployment.healthUrl='https://remote.example/health'
  ];
  for(const modify of changes){const x=fixture();modify(x);
    assert.throws(()=>buildRolloutPayload(x));
  }
});
test('reviewed Python source is gzip-packaged without shell input interpolation',()=>{
  const script=readFileSync(new URL('../scripts/deployment/ssm-host-rollout.py',import.meta.url),'utf8');
  const payload=buildRolloutPayload(fixture());
  const spec=packageRemoteRollout({hostScript:script,payload});
  assert.deepEqual(Object.keys(spec).sort(),['commands','executionTimeout']);
  assert.deepEqual(spec.executionTimeout,['3600']);
  const command=spec.commands[0];
  const encoded=command.match(/base64\.b64decode\("([A-Za-z0-9+/=]+)"\)/)?.[1];
  assert.ok(encoded,'missing gzip base64');
  assert.equal(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'),script);
  assert.ok(command.endsWith(JSON.stringify(payload)+'\nAPPFACTORY_JSON_PAYLOAD'));
  assert.ok(command.length<24000);
  assert.throws(()=>packageRemoteRollout({hostScript:'rm -rf /',payload}));
});
test('workflow can only mutate AWS after manual, verified staging execution',()=>{
  const text=readFileSync(
    new URL('../.github/workflows/reusable-container-ssm-rollout.yml',import.meta.url),'utf8');
  assert.match(text,/workflow_call:/);
  assert.doesNotMatch(text,/^\s+workflow_dispatch:/m);
  assert.match(text,/default: false/);
  assert.match(text,/inputs\.execute && needs\.verify\.result == 'success'/);
  assert.match(text,/environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(text,/appfactory-ssm-rollout-\$\{\{ github\.repository \}\}/);
  assert.match(text,/run: node \.appfactory\/scripts\/deployment\/check-staging-consent\.mjs/);
  assert.ok(text.indexOf('check-staging-consent.mjs')<text.indexOf('aws-actions/configure-aws-credentials@v4'));
  assert.ok(text.indexOf('verify-release-provenance.mjs')<text.indexOf('aws-actions/configure-aws-credentials@v4'));
  assert.match(text,/aws ec2 describe-instances/);
  assert.match(text,/aws ssm describe-instance-information/);
  assert.match(text,/aws ssm send-command/);
  assert.match(text,/Failed\|Cancelled\|TimedOut/);
  assert.match(text,/Requested staging rollout did not succeed/);
  assert.doesNotMatch(text,/^\s*packages: write/m);
});
