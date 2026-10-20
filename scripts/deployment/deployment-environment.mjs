export function validateDeploymentEnvironment({environment = 'staging', lifecycle,
  instanceId = '', publicOrigin = ''}) {
  if (!['staging', 'production'].includes(environment)) throw new Error('Invalid deployment environment');
  if (!['ephemeral', 'persistent'].includes(lifecycle)) throw new Error('Invalid host lifecycle');
  if (environment === 'production') {
    if (lifecycle !== 'persistent') throw new Error('Production requires a persistent host');
    if (!/^i-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(instanceId)) throw new Error('Production requires the exact existing instance ID');
    let url;
    try { url = new URL(publicOrigin); } catch { throw new Error('Production requires a public HTTPS origin'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Production requires a public HTTPS origin');
    }
  }
  return {environment, lifecycle, instanceId, publicOrigin};
}
