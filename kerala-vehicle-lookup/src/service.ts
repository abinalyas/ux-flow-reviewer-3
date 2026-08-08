import { TtlCache } from './cache';
import { applyPrivacy, resolvePrivacyMode } from './privacy';
import { parse } from './regno';
import { ProviderError, type VehicleDataProvider } from './providers';
import type { Challan, LookupResult, LookupSummary, PrivacyMode } from './types';

interface CachedPayload {
  vehicle: LookupResult['vehicle'];
  challans: Challan[];
  partial: boolean;
  warnings: string[];
  fetchedAt: string;
}

export interface LookupServiceOptions {
  privacyMode?: PrivacyMode;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
}

export function summarize(challans: readonly Challan[]): LookupSummary {
  const pending = challans.filter((c) => c.status === 'PENDING' || c.status === 'IN_COURT');
  return {
    pendingCount: pending.length,
    pendingAmount: pending.reduce((total, c) => total + c.amount, 0),
    totalCount: challans.length,
  };
}

export class LookupService {
  private readonly cache: TtlCache<CachedPayload>;
  private readonly privacyMode: PrivacyMode;
  private readonly now: () => number;

  constructor(
    private readonly provider: VehicleDataProvider,
    opts: LookupServiceOptions = {},
  ) {
    this.privacyMode = opts.privacyMode ?? resolvePrivacyMode(process.env.PRIVACY_MODE);
    this.now = opts.now ?? Date.now;
    this.cache = new TtlCache<CachedPayload>(
      opts.cacheTtlMs ?? 10 * 60_000,
      opts.cacheMaxEntries ?? 500,
      this.now,
    );
  }

  /**
   * Throws InvalidRegistrationNumberError for a malformed plate. Anything else
   * degrades: if the vehicle call succeeds and the challan call fails you still
   * get the vehicle, with `meta.partial` set and the reason in `meta.warnings`.
   * A total upstream failure throws, since there is nothing to show.
   */
  async lookup(input: string): Promise<LookupResult> {
    const startedAt = this.now();
    const plate = parse(input);
    const key = `${plate.normalized}:${this.privacyMode}`;

    const cached = this.cache.get(key);
    const payload = cached ?? (await this.fetch(plate.normalized));
    if (!cached) this.cache.set(key, payload);

    return {
      registrationNumber: plate.normalized,
      plate,
      vehicle: payload.vehicle,
      challans: payload.challans,
      summary: summarize(payload.challans),
      meta: {
        provider: this.provider.name,
        privacyMode: this.privacyMode,
        fetchedAt: payload.fetchedAt,
        cached: Boolean(cached),
        partial: payload.partial,
        warnings: payload.warnings,
        elapsedMs: this.now() - startedAt,
      },
    };
  }

  private async fetch(registrationNumber: string): Promise<CachedPayload> {
    const [vehicleResult, challanResult] = await Promise.allSettled([
      this.provider.getVehicle(registrationNumber),
      this.provider.getChallans(registrationNumber),
    ]);

    const warnings: string[] = [];

    if (vehicleResult.status === 'rejected' && challanResult.status === 'rejected') {
      throw vehicleResult.reason;
    }

    let vehicle: LookupResult['vehicle'] = null;
    if (vehicleResult.status === 'fulfilled') {
      vehicle = applyPrivacy(vehicleResult.value, this.privacyMode);
    } else {
      warnings.push(`Vehicle details unavailable: ${describe(vehicleResult.reason)}`);
    }

    let challans: Challan[] = [];
    if (challanResult.status === 'fulfilled') {
      challans = challanResult.value;
    } else {
      warnings.push(`Challan details unavailable: ${describe(challanResult.reason)}`);
    }

    return {
      vehicle,
      challans,
      partial: warnings.length > 0,
      warnings,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof ProviderError) return `${error.code} — ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
