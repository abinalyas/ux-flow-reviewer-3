import type { Challan, ChallanStatus, VehicleDetails } from '../types';
import { ProviderError, type VehicleDataProvider } from './provider';

/**
 * Adapter for the commercial VAHAN/eChallan aggregators (Surepass, Invincible
 * Ocean, Attestr, Eko, IDfy, Zoop and friends).
 *
 * There is no public MoRTH API you can just sign up for — see README. These
 * vendors are the practical route, and they all expose roughly the same shape:
 *
 *     POST {baseUrl}{path}
 *     Authorization: Bearer <token>
 *     { "id_number": "KL07BX1234" }
 *  -> { "data": { ...rc fields... } }
 *
 * They disagree on the details: the field name for the plate, the envelope key,
 * and the casing of every response field. Rather than write a new adapter per
 * vendor, the request shape is env-configurable and the response mapping goes
 * through `pick()`, which accepts any of the common aliases. Point it at your
 * vendor, run the contract test, and adjust the alias lists if something comes
 * back null.
 */

export interface AggregatorConfig {
  name: string;
  baseUrl: string;
  token: string;
  rcPath: string;
  challanPath: string;
  /** Request body key holding the registration number. */
  idField: string;
  authHeader: string;
  /** Prefix for the auth header value, e.g. "Bearer". Empty string for raw keys. */
  authScheme: string;
  timeoutMs: number;
  maxRetries: number;
}

export const DEFAULT_AGGREGATOR_CONFIG: Omit<AggregatorConfig, 'baseUrl' | 'token'> = {
  name: 'aggregator',
  rcPath: '/api/v1/rc/rc-full',
  challanPath: '/api/v1/challan/challan',
  idField: 'id_number',
  authHeader: 'Authorization',
  authScheme: 'Bearer',
  timeoutMs: 15_000,
  maxRetries: 2,
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First non-empty value among the given aliases, case/underscore insensitive. */
function pick(source: Json, aliases: readonly string[]): unknown {
  const flat = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    flat.set(key.toLowerCase().replace(/[^a-z0-9]/g, ''), value);
  }
  for (const alias of aliases) {
    const value = flat.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return true;
    if (['false', 'no', 'n', '0'].includes(v)) return false;
  }
  return null;
}

/** Unwraps the `{ data: ... }` / `{ result: ... }` envelopes vendors like to add. */
function unwrap(body: unknown): unknown {
  let current = body;
  for (let depth = 0; depth < 4; depth++) {
    if (!isRecord(current)) return current;
    const next = current['data'] ?? current['result'] ?? current['response'] ?? current['payload'];
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

export function normalizeChallanStatus(raw: unknown): ChallanStatus {
  const value = (asString(raw) ?? '').toUpperCase();
  if (!value) return 'UNKNOWN';
  if (value.includes('COURT')) return 'IN_COURT';
  if (value.includes('DISPOS')) return 'DISPOSED';
  if (value.includes('PAID') || value.includes('SUCCESS') || value.includes('CLEARED')) {
    return 'PAID';
  }
  if (value.includes('PEND') || value.includes('UNPAID') || value.includes('DUE')) return 'PENDING';
  return 'UNKNOWN';
}

export function mapVehicle(raw: unknown, registrationNumber: string): VehicleDetails | null {
  const data = unwrap(raw);
  if (!isRecord(data)) return null;
  if (Object.keys(data).length === 0) return null;

  const insuranceProvider = asString(pick(data, ['insurance_company', 'insuranceCompany', 'insurer']));
  const insurancePolicy = asString(pick(data, ['insurance_policy', 'policy_number', 'insurancePolicyNo']));
  const insuranceUpto = asString(pick(data, ['insurance_upto', 'insuranceUpto', 'insurance_validity']));

  return {
    registrationNumber:
      asString(pick(data, ['registration_number', 'rc_number', 'regn_no', 'vehicleNumber'])) ??
      registrationNumber,
    ownerName: asString(pick(data, ['owner_name', 'ownerName', 'owner'])),
    makerDescription: asString(pick(data, ['maker_description', 'maker', 'manufacturer', 'makerName'])),
    makerModel: asString(pick(data, ['maker_model', 'model', 'modelName', 'vehicleModel'])),
    vehicleClass: asString(pick(data, ['vehicle_class', 'vehicleClass', 'class', 'vehicleCategory'])),
    fuelType: asString(pick(data, ['fuel_type', 'fuelType', 'fuel'])),
    colour: asString(pick(data, ['colour', 'color', 'vehicleColour'])),
    registrationDate: asString(pick(data, ['registration_date', 'regn_dt', 'registrationDate'])),
    registeringAuthority: asString(pick(data, ['registered_at', 'rto_name', 'registeringAuthority', 'rto'])),
    chassisNumber: asString(pick(data, ['vehicle_chasi_number', 'chassis_number', 'chassisNo'])),
    engineNumber: asString(pick(data, ['vehicle_engine_number', 'engine_number', 'engineNo'])),
    insurance:
      insuranceProvider || insurancePolicy || insuranceUpto
        ? { provider: insuranceProvider, policyNumber: insurancePolicy, validUpto: insuranceUpto }
        : null,
    pucValidUpto: asString(pick(data, ['puc_upto', 'pucUpto', 'puc_valid_upto', 'pollutionUpto'])),
    fitnessValidUpto: asString(pick(data, ['fit_up_to', 'fitness_upto', 'fitnessUpto'])),
    taxValidUpto: asString(pick(data, ['tax_upto', 'taxUpto', 'tax_valid_upto'])),
    rcStatus: asString(pick(data, ['rc_status', 'status', 'rcStatus'])),
    financier: asString(pick(data, ['financer', 'financier', 'financierName'])),
    isBlacklisted: asBoolean(pick(data, ['blacklist_status', 'is_blacklisted', 'blacklisted'])),
  };
}

export function mapChallans(raw: unknown): Challan[] {
  const data = unwrap(raw);
  const list: unknown[] = Array.isArray(data)
    ? data
    : isRecord(data)
      ? ((pick(data, ['challans', 'challan_list', 'challanDetails', 'items']) as unknown[]) ?? [])
      : [];
  if (!Array.isArray(list)) return [];

  return list.filter(isRecord).map((entry) => {
    const offenceRaw = pick(entry, ['offences', 'offence_details', 'violation', 'offense']);
    const offences: string[] = Array.isArray(offenceRaw)
      ? offenceRaw.map((o) => (isRecord(o) ? (asString(pick(o, ['name', 'offence'])) ?? '') : String(o))).filter(Boolean)
      : offenceRaw
        ? [String(offenceRaw)]
        : [];

    return {
      challanNumber: asString(pick(entry, ['challan_number', 'challanNo', 'id'])) ?? 'UNKNOWN',
      challanDate: asString(pick(entry, ['challan_date', 'date', 'challanDateTime'])),
      offences,
      amount: asNumber(pick(entry, ['amount', 'fine_amount', 'challan_amount', 'penalty'])),
      status: normalizeChallanStatus(pick(entry, ['challan_status', 'status', 'payment_status'])),
      location: asString(pick(entry, ['location', 'place', 'challan_place'])),
      state: asString(pick(entry, ['state', 'state_code'])),
      courtName: asString(pick(entry, ['court_name', 'courtName'])),
      paymentUrl: asString(pick(entry, ['payment_url', 'paymentUrl', 'pay_link'])),
    };
  });
}

export class AggregatorProvider implements VehicleDataProvider {
  readonly name: string;

  constructor(
    private readonly config: AggregatorConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = config.name;
    if (!config.baseUrl || !config.token) {
      throw new ProviderError('Aggregator provider needs both a base URL and a token', {
        code: 'NOT_CONFIGURED',
      });
    }
  }

  private async post(path: string, registrationNumber: string): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl).toString();
    const authValue = this.config.authScheme
      ? `${this.config.authScheme} ${this.config.token}`
      : this.config.token;

    let lastError: ProviderError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        // 400ms, 800ms, 1600ms — enough to ride out a brief upstream wobble.
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            [this.config.authHeader]: authValue,
          },
          body: JSON.stringify({ [this.config.idField]: registrationNumber }),
          signal: controller.signal,
        });

        if (response.status === 404) {
          throw new ProviderError(`Not found upstream: ${registrationNumber}`, {
            code: 'NOT_FOUND',
            status: 404,
          });
        }
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError('Upstream rejected the credentials', {
            code: 'UNAUTHORIZED',
            status: response.status,
          });
        }
        if (response.status === 429) {
          throw new ProviderError('Upstream rate limit hit', {
            code: 'RATE_LIMITED',
            status: 429,
            retryable: true,
          });
        }
        if (!response.ok) {
          throw new ProviderError(`Upstream returned ${response.status}`, {
            code: 'UPSTREAM_ERROR',
            status: response.status,
            retryable: response.status >= 500,
          });
        }
        return await response.json();
      } catch (error) {
        const wrapped =
          error instanceof ProviderError
            ? error
            : error instanceof Error && error.name === 'AbortError'
              ? new ProviderError(`Upstream timed out after ${this.config.timeoutMs}ms`, {
                  code: 'TIMEOUT',
                  retryable: true,
                })
              : new ProviderError(
                  `Upstream call failed: ${error instanceof Error ? error.message : String(error)}`,
                  { code: 'UPSTREAM_ERROR', retryable: true },
                );
        lastError = wrapped;
        if (!wrapped.retryable) throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ProviderError('Upstream call failed', { code: 'UPSTREAM_ERROR' });
  }

  async getVehicle(registrationNumber: string): Promise<VehicleDetails | null> {
    try {
      return mapVehicle(await this.post(this.config.rcPath, registrationNumber), registrationNumber);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }

  async getChallans(registrationNumber: string): Promise<Challan[]> {
    try {
      return mapChallans(await this.post(this.config.challanPath, registrationNumber));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'NOT_FOUND') return [];
      throw error;
    }
  }
}
