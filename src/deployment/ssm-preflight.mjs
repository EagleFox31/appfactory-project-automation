const shaPattern = /^[a-f0-9]{40}$/;
function deny(message) { throw new Error('AWS SSM preflight: ' + message); }
function assertObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') deny(label + ' must be an object');
}
export function roleAccount(roleArn) {
  const match = /^arn:aws:iam::(\d{12}):role\/[A-Za-z0-9+=,.@_/-]+$/.exec(roleArn || '');
  if (!match) deny('invalid IAM role ARN');
  return match[1];
}
export function validateTargetSpec(config, repository, sha, requestedEnvironment) {
  assertObject(config, 'validated consumer config');
  const deploy = config.deployment;
  if (!deploy || deploy.transport !== 'aws-ssm') deny('an explicit AWS SSM deployment target is required');
  if (!shaPattern.test(sha || '')) deny('exact 40-character source SHA is required');
  if (requestedEnvironment !== config.environment) deny('requested environment does not match consumer config');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repository || ''))
    deny('invalid repository');
  if (deploy.ssmParameterPrefix !== '/appfactory/' + config.projectId + '/' + config.environment + '/')
    deny('cross-application SSM prefix');
  if (deploy.composeProject !== config.projectId + '-' + config.environment)
    deny('cross-application Compose project');
  const roleName = deploy.roleArn.split('/').at(-1);
  if (roleName !== config.projectId + '-' + config.environment
      && !roleName.startsWith(config.projectId + '-' + config.environment + '-'))
    deny('IAM role name must be dedicated to projectId-environment');
  roleAccount(deploy.roleArn);
  return {
    projectId: config.projectId,
    environment: config.environment,
    repository,
    sha,
    region: deploy.region,
    roleArn: deploy.roleArn,
    account: roleAccount(deploy.roleArn),
    instanceId: deploy.instanceId,
    composeProject: deploy.composeProject,
    parameterPrefix: deploy.ssmParameterPrefix
  };
}
export function checkTargetInspection(spec, { identity, instances, ssm }) {
  assertObject(spec, 'target specification');
  assertObject(identity, 'STS identity');
  assertObject(instances, 'EC2 response');
  assertObject(ssm, 'SSM response');
  if (identity.Account !== spec.account) deny('STS account mismatch');
  const matched = (instances.Reservations || []).flatMap(row => row.Instances || [])
    .filter(row => row.InstanceId === spec.instanceId);
  if (matched.length !== 1) deny('EC2 target is absent or ambiguous');
  const instance = matched[0];
  if (instance.State?.Name !== 'running') deny('EC2 target is not running');
  if (instance.PlatformDetails && !/linux/i.test(instance.PlatformDetails))
    deny('target platform must be Linux');
  const tags = Object.fromEntries((instance.Tags || []).map(row => [row.Key, row.Value]));
  const required = {
    AppFactoryProject: spec.projectId,
    AppFactoryEnvironment: spec.environment,
    AppFactoryRepository: spec.repository
  };
  for (const [key, value] of Object.entries(required))
    if (tags[key] !== value) deny(key + ' tag does not match expected application');
  const platform = instance.Architecture === 'arm64' ? 'linux/arm64'
    : instance.Architecture === 'x86_64' ? 'linux/amd64' : '';
  if (!platform) deny('unsupported EC2 target architecture');
  const ready = (ssm.InstanceInformationList || [])
    .filter(row => row.InstanceId === spec.instanceId);
  if (ready.length !== 1 || ready[0].PingStatus !== 'Online'
      || ready[0].PlatformType !== 'Linux') deny('target is not online as an SSM-managed Linux instance');
  return { instanceId: spec.instanceId, architecture: platform, tags, ssm: 'Online', account: spec.account };
}
export function assertImageArchitecture(config, inspected) {
  for (const image of config.images) {
    if (!image.platforms.split(',').includes(inspected.architecture))
      deny(image.name + ' image does not support ' + inspected.architecture);
  }
  return true;
}
