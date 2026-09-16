export function actionInputEnvironmentName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Action input name must be a non-empty string.');
  }

  return `INPUT_${name.trim().replace(/ /g, '_').toUpperCase()}`;
}

export function readActionInput(name, environment = process.env) {
  const canonicalName = actionInputEnvironmentName(name);
  if (Object.hasOwn(environment, canonicalName)) return environment[canonicalName];

  // Preserve the underscore form used by local tooling and older tests while
  // preferring GitHub Actions' canonical environment name.
  const compatibilityName = canonicalName.replaceAll('-', '_');
  return environment[compatibilityName] ?? '';
}
