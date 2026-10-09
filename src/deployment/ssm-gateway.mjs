import { validateSourceSha } from './contract.mjs';
import { gzipSync } from 'node:zlib';
import { validateReleaseManifest } from './manifest.mjs';
import { validateTargetSpec, assertImageArchitecture } from './ssm-preflight.mjs';

function reject(reason) { throw new Error('SSM rollout gateway: ' + reason); }
const ENVFILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/;

export function requireStagingConsent({config,sourceSha,requestedEnvironment,confirmation}) {
  const sha=validateSourceSha(sourceSha);
  if (config.environment !== 'staging' || requestedEnvironment !== 'staging')
    reject('only staging environments are permitted in the initial adapter');
  if (confirmation !== 'deploy:' + config.projectId + ':' + config.environment + ':' + sha)
    reject('explicit per-app/per-SHA confirmation is required');
  return true;
}

export function buildRolloutPayload({config,manifest,repository,sourceSha,inspection,
  requestedEnvironment,confirmation}) {
  const sha=validateSourceSha(sourceSha);
  requireStagingConsent({config,sourceSha:sha,requestedEnvironment,confirmation});
  const target=validateTargetSpec(config,repository,sha,requestedEnvironment);
  const deploy=config.deployment;
  if (!deploy?.imageServices || !deploy.backupKinds?.length || !deploy.healthUrl
      || !deploy.runtimeEnvTarget || !deploy.predeployHook)
    reject('service mapping, backup policy, localhost health and host paths are required');
  if(!ENVFILE.test(deploy.runtimeEnvTarget) || !ENVFILE.test(deploy.predeployHook))
    reject('unsafe host deployment path');
  if(!deploy.runtimeEnvTarget.split('/').at(-1).startsWith('.env'))
    reject('runtime environment must be a dedicated .env file');
  if(!inspection || inspection.instanceId!==target.instanceId ||
    inspection.account!==target.account || inspection.ssm!=='Online' ||
    inspection.tags?.AppFactoryProject!==config.projectId ||
    inspection.tags?.AppFactoryEnvironment!==config.environment ||
    inspection.tags?.AppFactoryRepository!==repository)
    reject('target failed exact tenant identity inspection');
  assertImageArchitecture(config,inspection);
  const artifact=validateReleaseManifest(manifest,{
    config,repository,sourceSha:sha,ciRunId:manifest?.ciRunId,buildRunId:manifest?.buildRunId
  });
  const images={};
  for(const item of artifact.images){
    images[item.name]=item.ref;
  }
  if(Object.keys(images).length!==config.images.length ||
    Object.keys(deploy.imageServices).length!==config.images.length)
    reject('incomplete application image mapping');
  for(const imageName of Object.keys(images)){
    if(!(imageName in deploy.imageServices))reject('missing Compose mapping for '+imageName);
    if(!deploy.serviceNames.includes(deploy.imageServices[imageName]))
      reject('unapproved Compose service: '+imageName);
  }
  return {
    schemaVersion:1,
    projectId:config.projectId,environment:config.environment,repository,sourceSha:sha,
    composeProject:deploy.composeProject,composePath:config.composePath,
    runtimeEnvTarget:deploy.runtimeEnvTarget,predeployHook:deploy.predeployHook,
    healthUrl:deploy.healthUrl,images,imageServices:deploy.imageServices,
    backupKinds:deploy.backupKinds
  };
}

export function packageRemoteRollout({hostScript,payload}) {
  if(typeof hostScript!=='string' || !hostScript.startsWith('#!/usr/bin/env python3'))
    reject('host script must be a reviewed Python 3 file');
  if(typeof payload!=='object' || payload===null)reject('deployment payload is missing');
  const program=gzipSync(Buffer.from(hostScript,'utf8'),{level:9}).toString('base64');
  if(!/^[A-Za-z0-9+/=]+$/.test(program))reject('invalid Python payload encoding');
  // stdin JSON is one escaped line: no shell interpolation or workflow input shell injection.
  const data=JSON.stringify(payload);
  if(data.includes('\n') || data.includes('\r'))reject('multiline data is forbidden');
  const command="python3 -c 'import base64,gzip;exec(compile(gzip.decompress(base64.b64decode(\""
    +program+"\"),\"ssm-host-rollout.py\",\"exec\"))' <<'APPFACTORY_JSON_PAYLOAD'\n"
    +data+"\nAPPFACTORY_JSON_PAYLOAD";
  if(command.length>24000)reject('SSM command exceeds reviewable input size');
  return {commands:[command],executionTimeout:['3600']};
}
