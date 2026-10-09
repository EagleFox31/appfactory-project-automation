import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTargetSpec, checkTargetInspection, assertImageArchitecture, roleAccount } from '../src/deployment/ssm-preflight.mjs';

const sha='e'.repeat(40), repository='EagleFox31/Pr-cis-Translation';
const config={
  projectId:'precis-translation',environment:'staging',
  images:[
    {name:'api',platforms:'linux/arm64,linux/amd64'},
    {name:'web',platforms:'linux/arm64,linux/amd64'}
  ],
  deployment:{
    transport:'aws-ssm',
    region:'eu-west-3',
    roleArn:'arn:aws:iam::123456789012:role/precis-translation-staging',
    instanceId:'i-abcdef01234567890',
    ssmParameterPrefix:'/appfactory/precis-translation/staging/',
    composeProject:'precis-translation-staging',
    healthPath:'/health',serviceNames:['backend','web']
  }
};
const inspection={
  identity:{Account:'123456789012',Arn:'arn:aws:sts::123456789012:assumed-role/precis-translation-staging/test'},
  instances:{Reservations:[{Instances:[{
    InstanceId:'i-abcdef01234567890',Architecture:'aarch64',
    State:{Name:'running'},PlatformDetails:'Linux/UNIX',
    Tags:[
      {Key:'AppFactoryProject',Value:'precis-translation'},
      {Key:'AppFactoryEnvironment',Value:'staging'},
      {Key:'AppFactoryRepository',Value:repository}
    ]
  }]}]},
  ssm:{InstanceInformationList:[{InstanceId:'i-abcdef01234567890',PingStatus:'Online',PlatformType:'Linux'}]}
};
// AWS uses arm64, not aarch64, as the EC2 Architecture API value.
inspection.instances.Reservations[0].Instances[0].Architecture='arm64';
function prepared(configInput=config) {
  return validateTargetSpec(configInput,repository,sha,'staging');
}
function inspect(base=inspection,spec=prepared()) {
  return checkTargetInspection(spec,base);
}
test('SSM preflight binds IAM role, instance and parameter path to exact application',()=>{
  const s=prepared();
  assert.equal(s.account,'123456789012');
  assert.equal(s.composeProject,'precis-translation-staging');
  assert.equal(inspect().architecture,'linux/arm64');
  assert.equal(assertImageArchitecture(config,inspect()),true);
});
test('reject missing target, wrong environment and cross-project deployment role',()=>{
  assert.throws(()=>validateTargetSpec({...config,deployment:null},repository,sha,'staging'));
  assert.throws(()=>validateTargetSpec(config,repository,sha,'prod'));
  assert.throws(()=>validateTargetSpec(config,repository,'main','staging'));
  assert.throws(()=>validateTargetSpec({...config,deployment:{
    ...config.deployment,roleArn:'arn:aws:iam::123456789012:role/atelier-maitre-prod'
  }},repository,sha,'staging'));
  assert.throws(()=>validateTargetSpec({...config,deployment:{
    ...config.deployment,ssmParameterPrefix:'/appfactory/another-project/staging/'
  }},repository,sha,'staging'));
  assert.throws(()=>validateTargetSpec({...config,deployment:{
    ...config.deployment,composeProject:'atelier-maitre-prod'
  }},repository,sha,'staging'));
  assert.throws(()=>roleAccount('arn:aws:iam::123456789012:role/unsafe;rm -rf'));
});
test('reject wrong AWS account, wrong target, wrong tags, wrong platform or offline SSM',()=>{
  const base=structuredClone(inspection);
  const variants=[
    b=>b.identity.Account='987654321098',
    b=>b.instances.Reservations[0].Instances[0].InstanceId='i-00000000000000000',
    b=>b.instances.Reservations[0].Instances[0].State.Name='terminated',
    b=>b.instances.Reservations[0].Instances[0].Tags[0].Value='atelier-maitre',
    b=>b.instances.Reservations[0].Instances[0].Tags[1].Value='production',
    b=>b.instances.Reservations[0].Instances[0].Tags[2].Value='EagleFox31/atelier2026',
    b=>b.instances.Reservations[0].Instances[0].Architecture='i386',
    b=>b.instances.Reservations[0].Instances[0].PlatformDetails='Windows',
    b=>b.ssm.InstanceInformationList[0].PingStatus='ConnectionLost',
    b=>b.ssm.InstanceInformationList[0].PlatformType='Windows',
    b=>b.ssm.InstanceInformationList=[]
  ];
  for(const mutate of variants){
    const payload=structuredClone(base);
    mutate(payload);
    assert.throws(()=>inspect(payload));
  }
});
test('every image must support the target instance CPU architecture',()=>{
  const tooNarrow={...config,images:[
    {name:'api',platforms:'linux/amd64'},
    {name:'web',platforms:'linux/amd64,linux/arm64'}
  ]};
  assert.throws(()=>assertImageArchitecture(tooNarrow,inspect()),/api/);
});
test('workflow only inspects; it never has resource mutation actions',()=>{
  const file=readFileSync(new URL('../.github/workflows/reusable-container-ssm-preflight.yml',import.meta.url),'utf8');
  assert.match(file,/workflow_dispatch/);
  assert.match(file,/environment: \$\{\{ needs\.validate\.outputs\.environment \}\}/);
  assert.match(file,/id-token: write/);
  assert.match(file,/configure-aws-credentials@v4/);
  assert.match(file,/aws ec2 describe-instances/);
  assert.match(file,/aws ssm describe-instance-information/);
  assert.match(file,/aws sts get-caller-identity/);
  assert.doesNotMatch(file,/^\s*aws (ssm send-command|ec2 run-instances|ec2 modify-instance|ssm put-parameter)\b/m);
  assert.doesNotMatch(file,/^\s*packages: write/m);
  assert.doesNotMatch(file,/^\s*contents: write/m);
});
