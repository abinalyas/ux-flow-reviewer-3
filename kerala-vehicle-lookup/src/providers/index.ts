import { AggregatorProvider, DEFAULT_AGGREGATOR_CONFIG, type AggregatorConfig } from './aggregator';
import { MockProvider } from './mock';
import { ProviderError, type VehicleDataProvider } from './provider';

export * from './provider';
export { AggregatorProvider, DEFAULT_AGGREGATOR_CONFIG, mapChallans, mapVehicle } from './aggregator';
export { MockProvider } from './mock';

export type ProviderName = 'mock' | 'aggregator';

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function aggregatorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AggregatorConfig {
  return {
    name: env.AGGREGATOR_NAME ?? DEFAULT_AGGREGATOR_CONFIG.name,
    baseUrl: env.AGGREGATOR_BASE_URL ?? '',
    token: env.AGGREGATOR_TOKEN ?? '',
    rcPath: env.AGGREGATOR_RC_PATH ?? DEFAULT_AGGREGATOR_CONFIG.rcPath,
    challanPath: env.AGGREGATOR_CHALLAN_PATH ?? DEFAULT_AGGREGATOR_CONFIG.challanPath,
    idField: env.AGGREGATOR_ID_FIELD ?? DEFAULT_AGGREGATOR_CONFIG.idField,
    authHeader: env.AGGREGATOR_AUTH_HEADER ?? DEFAULT_AGGREGATOR_CONFIG.authHeader,
    authScheme: env.AGGREGATOR_AUTH_SCHEME ?? DEFAULT_AGGREGATOR_CONFIG.authScheme,
    timeoutMs: intFromEnv(env, 'AGGREGATOR_TIMEOUT_MS', DEFAULT_AGGREGATOR_CONFIG.timeoutMs),
    maxRetries: intFromEnv(env, 'AGGREGATOR_MAX_RETRIES', DEFAULT_AGGREGATOR_CONFIG.maxRetries),
  };
}

/**
 * Picks a provider from the environment. Defaults to `mock` on purpose: an
 * accidental deploy should cost nothing and leak nothing, not silently start
 * billing real lookups.
 */
export function createProvider(env: NodeJS.ProcessEnv = process.env): VehicleDataProvider {
  const requested = (env.PROVIDER ?? 'mock').toLowerCase() as ProviderName;

  switch (requested) {
    case 'mock':
      return new MockProvider({
        synthesize: env.MOCK_SYNTHESIZE !== 'false',
        latencyMs: intFromEnv(env, 'MOCK_LATENCY_MS', 0),
      });
    case 'aggregator': {
      const config = aggregatorConfigFromEnv(env);
      if (!config.baseUrl || !config.token) {
        throw new ProviderError(
          'PROVIDER=aggregator needs AGGREGATOR_BASE_URL and AGGREGATOR_TOKEN (see .env.example)',
          { code: 'NOT_CONFIGURED' },
        );
      }
      return new AggregatorProvider(config);
    }
    default:
      throw new ProviderError(`Unknown PROVIDER "${requested}" (expected "mock" or "aggregator")`, {
        code: 'UNSUPPORTED',
      });
  }
}
