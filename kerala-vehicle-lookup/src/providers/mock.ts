import type { Challan, VehicleDetails } from '../types';
import { parse } from '../regno';
import { ProviderError, type VehicleDataProvider } from './provider';

/**
 * Offline provider. Everything is synthetic and deterministic — the same plate
 * always yields the same vehicle and the same challans, so screenshots, demos
 * and tests are stable without spending a single upstream call.
 *
 * NOTHING HERE IS REAL DATA. Do not present mock output as a genuine lookup.
 */

const MAKERS: readonly [string, string][] = [
  ['MARUTI SUZUKI INDIA LTD', 'SWIFT VDI'],
  ['HYUNDAI MOTOR INDIA LTD', 'i20 SPORTZ'],
  ['TATA MOTORS LTD', 'NEXON XZ PLUS'],
  ['HONDA MOTORCYCLE AND SCOOTER INDIA', 'ACTIVA 6G'],
  ['BAJAJ AUTO LTD', 'PULSAR NS200'],
  ['MAHINDRA & MAHINDRA LTD', 'XUV700 AX7'],
  ['TVS MOTOR COMPANY LTD', 'JUPITER 110'],
  ['KIA INDIA PVT LTD', 'SELTOS HTK PLUS'],
];

const OWNERS = [
  'RAJESH KUMAR NAIR',
  'ANJALI MENON',
  'MOHAMMED ASHRAF',
  'SREEJITH P V',
  'FATHIMA BEEVI',
  'THOMAS VARGHESE',
  'DEEPA SURESH',
  'ABDUL RAHMAN K',
];

const INSURERS = [
  'ICICI Lombard General Insurance',
  'The New India Assurance Co. Ltd',
  'Bajaj Allianz General Insurance',
  'HDFC ERGO General Insurance',
];

const OFFENCES = [
  'Riding without helmet',
  'Over speeding',
  'Driving without seat belt',
  'Using mobile phone while driving',
  'Jumping red light',
  'Unauthorised parking',
  'Driving without valid insurance',
];

const LOCATIONS = [
  'NH-66, Edappally, Ernakulam',
  'MG Road, Thiruvananthapuram',
  'Bypass Junction, Kollam',
  'Kozhikode Beach Road',
  'Thrissur Round East',
];

/** FNV-1a — small, dependency-free, and stable across runs. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], seed: number): T {
  // Callers derive seeds with `>>`, which coerces to int32 and can go negative
  // for hashes above 2^31 — normalize so the index is always in range.
  const index = ((Math.trunc(seed) % items.length) + items.length) % items.length;
  // Non-null: callers only pass non-empty literal arrays.
  return items[index]!;
}

/** A historical date, for things like the original registration. */
function isoDate(daysFromEpochBase: number): string {
  const base = Date.UTC(2015, 0, 1);
  return new Date(base + daysFromEpochBase * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A date relative to today, for validity fields. Offsets straddle zero on
 * purpose so a demo run shows both live and lapsed insurance/PUC/tax.
 */
function isoDateFromNow(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export interface MockProviderOptions {
  /**
   * When false, only plates present in the fixture set resolve; everything else
   * returns null. When true (default) any well-formed plate gets deterministic
   * synthetic data, which is what you want for a clickable demo.
   */
  synthesize?: boolean;
  /** Artificial latency in ms, to make the UI's loading states realistic. */
  latencyMs?: number;
}

export class MockProvider implements VehicleDataProvider {
  readonly name = 'mock';
  private readonly synthesize: boolean;
  private readonly latencyMs: number;

  constructor(opts: MockProviderOptions = {}) {
    this.synthesize = opts.synthesize ?? true;
    this.latencyMs = opts.latencyMs ?? 0;
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async getVehicle(registrationNumber: string): Promise<VehicleDetails | null> {
    await this.delay();
    const plate = parse(registrationNumber);
    const seed = hash(plate.normalized);

    // A reserved plate for exercising the not-found path.
    if (plate.normalized === 'KL00XX0000') return null;
    if (!this.synthesize) return null;

    const maker = pick(MAKERS, seed);
    const regDays = 1000 + (seed % 3200);
    const isCommercial = seed % 11 === 0;

    return {
      registrationNumber: plate.normalized,
      ownerName: pick(OWNERS, seed >> 3),
      makerDescription: maker[0],
      makerModel: maker[1],
      vehicleClass: isCommercial ? 'LMV-Transport' : seed % 3 === 0 ? 'M-Cycle/Scooter' : 'LMV',
      fuelType: seed % 7 === 0 ? 'ELECTRIC(BOV)' : seed % 2 === 0 ? 'PETROL' : 'DIESEL',
      colour: pick(['WHITE', 'SILVER', 'RED', 'BLACK', 'BLUE'], seed >> 5),
      registrationDate: isoDate(regDays),
      registeringAuthority: plate.rtoOffice ? `RTO ${plate.rtoOffice}` : null,
      chassisNumber: `MA3${plate.normalized}${(seed % 100000).toString().padStart(5, '0')}`,
      engineNumber: `EN${(seed % 100000000).toString().padStart(8, '0')}`,
      insurance: {
        provider: pick(INSURERS, seed >> 7),
        policyNumber: `POL${(seed % 1000000000).toString().padStart(9, '0')}`,
        validUpto: isoDateFromNow((seed % 500) - 120),
      },
      pucValidUpto: isoDateFromNow((seed % 300) - 60),
      fitnessValidUpto: isCommercial ? isoDateFromNow((seed % 400) - 90) : null,
      taxValidUpto: isoDateFromNow((seed % 900) - 100),
      rcStatus: seed % 23 === 0 ? 'SUSPENDED' : 'ACTIVE',
      financier: seed % 4 === 0 ? 'HDFC BANK LTD' : null,
      isBlacklisted: seed % 29 === 0,
    };
  }

  async getChallans(registrationNumber: string): Promise<Challan[]> {
    await this.delay();
    const plate = parse(registrationNumber);
    const seed = hash(plate.normalized + ':challan');

    if (plate.normalized === 'KL00XX0000') return [];
    if (!this.synthesize) return [];

    const count = seed % 5; // 0..4, so "no pending fines" is a common outcome
    const challans: Challan[] = [];

    for (let i = 0; i < count; i++) {
      const s = hash(`${plate.normalized}:${i}`);
      const paid = s % 3 === 0;
      const inCourt = !paid && s % 7 === 0;
      challans.push({
        challanNumber: `KL${(s % 1_000_000_000_000).toString().padStart(12, '0')}`,
        challanDate: isoDateFromNow(-1 - (s % 700)),
        offences: [pick(OFFENCES, s), ...(s % 6 === 0 ? [pick(OFFENCES, s >> 4)] : [])],
        amount: [250, 500, 750, 1000, 1500, 2000, 5000][s % 7]!,
        status: paid ? 'PAID' : inCourt ? 'IN_COURT' : 'PENDING',
        location: pick(LOCATIONS, s >> 2),
        state: plate.stateCode === 'BH' ? null : plate.stateCode,
        courtName: inCourt ? 'Virtual Court, Kerala' : null,
        paymentUrl: paid ? null : 'https://echallan.parivahan.gov.in/index/accused-challan',
      });
    }
    return challans;
  }
}

/** Used by the factory when someone asks for a provider that is not built yet. */
export class UnsupportedProvider implements VehicleDataProvider {
  constructor(readonly name: string) {}
  private fail(): never {
    throw new ProviderError(`Provider "${this.name}" is not implemented`, { code: 'UNSUPPORTED' });
  }
  async getVehicle(): Promise<VehicleDetails | null> {
    this.fail();
  }
  async getChallans(): Promise<Challan[]> {
    this.fail();
  }
}
