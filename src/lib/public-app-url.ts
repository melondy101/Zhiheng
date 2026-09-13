/**
 * Builds a browser-facing URL when the application runs behind a reverse proxy.
 * CloudBase forwards requests to the container's internal 0.0.0.0:3000 listener,
 * so request.url alone is not a safe public redirect origin in production.
 */
export function buildPublicAppUrl(path: string, requestUrl: string, publicBaseUrl = process.env.SHARE_BASE_URL): URL {
  const configuredBase = publicBaseUrl?.trim().replace(/\/+$/, '');
  if (configuredBase) {
    try {
      const base = new URL(configuredBase);
      if (base.protocol === 'https:' || base.protocol === 'http:') return new URL(path, base);
    } catch {
      // Keep local development usable if an optional deployment variable is malformed.
    }
  }
  return new URL(path, requestUrl);
}
