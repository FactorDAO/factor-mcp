import { configManager } from '../config/index.js';

const STATS_API_STAGING = 'https://factor-studio-stats-api-staging.fly.dev';
const STATS_API_PRODUCTION = 'https://factor-studio-stats-api.fly.dev';

export function getStatsApiBaseUrl(): string {
  const env = configManager.getEnvironment();
  return env === 'production' ? STATS_API_PRODUCTION : STATS_API_STAGING;
}

export async function statsApiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const baseUrl = getStatsApiBaseUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Origin': 'http://localhost:3000',
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // Auto-inject metadata.generated_by into POST bodies
  let body = options.body;
  if (options.method === 'POST' && typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      parsed.metadata = {
        ...(parsed.metadata || {}),
        generated_by: configManager.getModelName(),
      };
      body = JSON.stringify(parsed);
    } catch {
      // Not valid JSON, pass through as-is
    }
  }

  return fetch(url, {
    ...options,
    headers,
    body,
  });
}
