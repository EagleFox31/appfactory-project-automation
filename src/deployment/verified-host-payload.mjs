import { resolve } from 'node:path';
import { validateContainerConfig, validateSourceSha } from './contract.mjs';
import { validateReleaseManifest } from './manifest.mjs';
import { validateTargetSpec, checkTargetInspection, assertImageArchitecture } from './ssm-preflight.mjs';

function deny(message) { throw new Error('Verified rollout payload: '+message); }
function sameKeys(actual, expected, label) {
  if (!actual || Array.isArray(actual) || typeof actual!=='object'
      || Object.keys(actual).sort().join('|')!==expected.slice().sort().join('|'))
    deny(label+' has missing or unexpected fields');
}
function checkedHookPath(value, config, root) {
  if (typeof value!=='string' || !/^[A-Za-z0-9_./-]+$/.test(value)
      || value.startsWith('/') || value.startsWith('./')
      || value.includes('//') || value.split('/').includes('..')) deny('unsafe predeploy hook path');
  const path=resolve(root,value);
  if (!path.startsWith(resolve(root)+'/')) deny('hook escapes consumer checkout');
  return value;
}
export function assembleVerifiedHostPayload({
  rawConfig, repository, sourceSha, requestedEnvironment, manifest,
  provenance, awsIdentity, awsInstances, awsSsm, root=process.cwd()
}) {
  const sha=validateSourceSha(sourceSha);
  const config=validateContainerConfig(rawConfig,{repository,root});
  if (requestedEnvironment!==config.environment) deny('environment mismatch');
  const spec=validateTargetSpec(config,repository,sha,requestedEnvironment);
  const inspected=checkTargetInspection(spec,{
    identity:awsIdentity,instances:awsInstances,ssm:awsSsm
  });
  assertImageArchitecture(config,inspected);
  const deploy=config.deployment;
  if (!deploy || !deploy.imageServices || !deploy.backupKinds || !deploy.healthUrl
      || !deploy.predeployHook || !deploy.runtimeEnvTarget)
    deny('rollout requires explicit services, backups, localhost health, env target and drain hook');
  checkedHookPath(deploy.predeployHook,config,root);
  const url=new URL(deploy.healthUrl);
  if (url.hostname!=='127.0.0.1' || url.pathname!==deploy.healthPath
      || url.username || url.password || url.search || url.hash)
    deny('health check must match the declared loopback health path');
  if (!provenance || provenance.ciRunId!==manifest?.ciRunId
      || provenance.buildRunId!==manifest?.buildRunId
      || !provenance.manifest) deny('authenticated CI and publisher provenance required');
  // The caller MUST obtain provenance directly from verifyReleaseProvenance
  // using GitHub run metadata, not from a caller-controlled input or artifact.
  const checked=validateReleaseManifest(manifest,{
    config,repository,sourceSha:sha,ciRunId:provenance.ciRunId,
    buildRunId:provenance.buildRunId
  });
  if (JSON.stringify(checked)!==JSON.stringify(provenance.manifest))
    deny('artifact differs from GitHub-verified release manifest');
  const imageNames=checked.images.map(image=>image.name).sort();
  if (Object.keys(deploy.imageServices).sort().join('|')!==imageNames.join('|'))
    deny('every release image must be mapped once');
  const imageRefs=Object.fromEntries(checked.images.map(image=>[image.name,image.ref]));
  if (Object.values(deploy.imageServices).some(name=>!deploy.serviceNames.includes(name)))
    deny('unapproved Compose service');
  return {
    schemaVersion:1,
    projectId:config.projectId,
    environment:config.environment,
    repository,
    sourceSha:sha,
    composeProject:deploy.composeProject,
    composePath:config.composePath,
    runtimeEnvTarget:deploy.runtimeEnvTarget,
    predeployHook:deploy.predeployHook,
    healthUrl:deploy.healthUrl,
    images:imageRefs,
    imageServices:deploy.imageServices,
    backupKinds:deploy.backupKinds
  };
}
