import {existsSync, readFileSync} from 'node:fs';

type Environment = Readonly<Record<string, string | undefined>>;
type TokenFiles = { exists(path: string): boolean; read(path: string): string };
const tokenFiles: TokenFiles = {exists: existsSync, read: path => readFileSync(path, 'utf8')};
const sessionToken = '/snowflake/session/token';

export function resolveAIBaseURL(env: Environment = process.env, files: TokenFiles = tokenFiles): string | undefined {
  if (env.AI_BASE_URL?.trim()) return env.AI_BASE_URL.trim();
  const host = env.SNOWFLAKE_HOST?.trim();
  const runtime = files.exists(sessionToken), protocol = runtime ? env.SNOWFLAKE_PROTOCOL ?? 'https' : 'https', port = runtime ? env.SNOWFLAKE_PORT : undefined;
  if (!['http','https'].includes(protocol) || (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))) return undefined;
  return host ? `${protocol}://${host}${port ? `:${port}` : ''}/api/v2/${env.AI_TARGET === 'gateway' ? 'aigateways/SNOWFLAKE' : 'cortex'}/v1` : undefined;
}

/** The Snowflake service credential must never be sent to an external AI endpoint. */
export function resolveAIToken(baseURL: string | undefined, env: Environment = process.env, files: TokenFiles = tokenFiles): string | undefined {
  let snowflakeAI = false;
  if (baseURL && env.SNOWFLAKE_HOST) {
    try {
      const url = new URL(baseURL);
      const runtime = files.exists(sessionToken), protocol = runtime ? env.SNOWFLAKE_PROTOCOL ?? 'https' : 'https', port = runtime ? env.SNOWFLAKE_PORT : undefined;
      const expected = new URL(`${protocol}://${env.SNOWFLAKE_HOST.trim()}${port ? `:${port}` : ''}`);
      snowflakeAI = ['http:', 'https:'].includes(expected.protocol) && url.origin === expected.origin && !url.username && !url.password &&
        url.hostname.toLowerCase() === env.SNOWFLAKE_HOST.trim().toLowerCase() &&
        /^\/api\/v2\/(?:cortex|aigateways\/[^/]+)(?:\/v1(?:\/|$)|\/?$)/.test(url.pathname) && !url.search && !url.hash;
    } catch { /* Invalid endpoints cannot acquire a service credential. */ }
  }
  const path = snowflakeAI && files.exists(sessionToken) ? sessionToken : env.AI_API_KEY_FILE?.trim();
  if (path) {
    try { return files.read(path).trim() || undefined; }
    catch { return undefined; }
  }
  return env.AI_API_KEY?.trim() || undefined;
}
