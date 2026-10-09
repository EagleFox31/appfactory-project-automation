import { validateSourceSha } from './contract.mjs';
import { validateReleaseManifest } from './manifest.mjs';
import { validateTargetSpec, assertImageArchitecture } from './ssm-preflight.mjs';

const DIGEST_REF = /^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
function deny(reason) { throw new Error('Compose rollout plan: ' + reason); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) deny(name + ' must be an object');
  return value;
}
function ensureKeys(actual, expected, label) {
  if (Object.keys(actual).sort().join('|') !== [...expected].sort().join('|'))
    deny(label + ' has missing or unexpected fields');
}
function isFresh(value, now) {
  const time=Date.parse(value);
  return Number.isFinite(time) && time >= now-15*60*1000 && time <= now+60*1000;
}
function validatePreviousState(state,{repository,config}) {
  object(state,'previous deployment state');
  ensureKeys(state,['schemaVersion','repository','projectId','environment','sourceSha','images',
    'composeChecksum'], 'previous deployment state');
  if(state.schemaVersion!==1 || state.repository!==repository
    ||state.projectId!==config.projectId ||state.environment!==config.environment)
    deny('previous deployment belongs to a different application/environment');
  validateSourceSha(state.sourceSha);
  if(typeof state.composeChecksum!=='string' || !DIGEST.test(state.composeChecksum))
    deny('previous Compose checksum missing');
  if(!Array.isArray(state.images) || state.images.length!==config.images.length)
    deny('previous deployment image set mismatch');
  const names=new Set();
  for(const image of state.images){
    object(image,'previous image');
    ensureKeys(image,['name','ref'],'previous image');
    if(names.has(image.name))deny('duplicate previous image');
    names.add(image.name);
    if(!DIGEST_REF.test(image.ref))deny('previous image is mutable or foreign');
    const expected=config.images.find(row=>row.name===image.name);
    if(!expected || !image.ref.startsWith(expected.image+'@sha256:'))
      deny('previous deployment contains another repository image');
  }
  return state;
}
function validateBackupEvidence(evidence,{config,sourceSha,now}) {
  object(evidence,'backup evidence');
  ensureKeys(evidence,['projectId','environment','sourceSha','createdAt',
    'quiescent','artifacts'], 'backup evidence');
  if(evidence.projectId!==config.projectId || evidence.environment!==config.environment
      ||evidence.sourceSha!==sourceSha)deny('backup evidence does not match target release');
  if(evidence.quiescent!==true)deny('active long-running work was not drained');
  if(!isFresh(evidence.createdAt,now))deny('backup is stale or from the future');
  if(!Array.isArray(evidence.artifacts) || evidence.artifacts.length<1)
    deny('backup evidence is empty');
  const required=config.deployment.backupKinds;
  if(!Array.isArray(required) || !required.length)
    deny('an explicit backup-kind policy is required');
  const kinds=new Set();
  const base='/opt/appfactory/'+config.projectId+'/'+config.environment+'/backups/';
  for(const artifact of evidence.artifacts){
    object(artifact,'backup artifact');
    ensureKeys(artifact,['kind','path','sha256','bytes'],'backup artifact');
    if(kinds.has(artifact.kind))deny('duplicate backup kind');
    kinds.add(artifact.kind);
    if(!required.includes(artifact.kind))deny('unexpected backup kind');
    if(typeof artifact.path!=='string' || !artifact.path.startsWith(base)
      || artifact.path.includes('..') || artifact.path.includes('//')
      || !/^\/[a-zA-Z0-9_./-]+$/.test(artifact.path))
      deny('backup path escapes dedicated tenant storage');
    if(typeof artifact.sha256!=='string' || !DIGEST.test(artifact.sha256))
      deny('backup artifact checksum is invalid');
    if(!Number.isSafeInteger(artifact.bytes) || artifact.bytes<1)
      deny('backup artifact must be non-empty');
  }
  for(const requiredKind of required)
    if(!kinds.has(requiredKind))deny('missing required backup: '+requiredKind);
  return evidence;
}
export function prepareRolloutPlan({config,repository,sourceSha,manifest,inspection,
  priorState,backupEvidence,composeChecksum,now=new Date()}) {
  const timestamp=now instanceof Date?now.getTime():NaN;
  if(!Number.isFinite(timestamp))deny('invalid planning clock');
  const sha=validateSourceSha(sourceSha);
  const deploy=object(config?.deployment,'deployment config');
  if(!deploy.imageServices || !deploy.healthUrl || !deploy.backupKinds)
    deny('image service mapping, health URL and backup kinds are mandatory');
  if(typeof composeChecksum!=='string' || !DIGEST.test(composeChecksum))
    deny('release Compose checksum required');
  const spec=validateTargetSpec(config,repository,sha,config.environment);
  if(!inspection || inspection.instanceId!==spec.instanceId
    ||inspection.account!==spec.account || inspection.ssm!=='Online'
    ||inspection.tags?.AppFactoryProject!==config.projectId
    ||inspection.tags?.AppFactoryEnvironment!==config.environment
    ||inspection.tags?.AppFactoryRepository!==repository)
    deny('EC2/SSM identity has not been verified for this tenant');
  assertImageArchitecture(config,inspection);
  const validated=validateReleaseManifest(manifest,{
    config,repository,sourceSha:sha,
    ciRunId:manifest?.ciRunId,buildRunId:manifest?.buildRunId
  });
  const previous=validatePreviousState(priorState,{repository,config});
  const backup=validateBackupEvidence(backupEvidence,{config,sourceSha:sha,now:timestamp});
  const images=new Map(validated.images.map(row=>[row.name,row]));
  const oldImages=new Map(previous.images.map(row=>[row.name,row]));
  const nextServices={}, rollbackServices={};
  for(const [name,service] of Object.entries(deploy.imageServices)){
    if(!deploy.serviceNames.includes(service))deny('target Compose service not permitted');
    if(!images.has(name)||!oldImages.has(name))deny('missing image digest for service '+name);
    nextServices[service]={image:images.get(name).ref};
    rollbackServices[service]={image:oldImages.get(name).ref};
  }
  if(Object.keys(nextServices).length!==config.images.length)
    deny('not every release image is mapped to a Compose service');
  return {
    schemaVersion:1,repository,projectId:config.projectId,environment:config.environment,
    sourceSha:sha,ciRunId:validated.ciRunId,buildRunId:validated.buildRunId,
    targetInstance:spec.instanceId,composeProject:deploy.composeProject,
    healthUrl:deploy.healthUrl,backupEvidenceCreatedAt:backup.createdAt,
    nextOverride:{services:nextServices},
    rollbackOverride:{services:rollbackServices},
    rollbackEligible:previous.composeChecksum===composeChecksum,
    previousComposeChecksum:previous.composeChecksum,
    nextComposeChecksum:composeChecksum,
    approvedServices:Object.keys(nextServices).sort()
  };
}
