/** Normalized domain model. Every provider maps into these shapes. */

export type ChallanStatus = 'PENDING' | 'PAID' | 'DISPOSED' | 'IN_COURT' | 'UNKNOWN';

export type PrivacyMode = 'masked' | 'full';

/** Everything derivable from the plate itself, with no network call. */
export interface PlateInfo {
  /** Normalized, e.g. "KL07BX1234". */
  normalized: string;
  /** Human formatted, e.g. "KL 07 BX 1234". */
  formatted: string;
  format: 'standard' | 'bh-series';
  stateCode: string;
  stateName: string | null;
  /** RTO serial as written on the plate, e.g. "07". Null for BH-series. */
  rtoCode: string | null;
  /** Registering office, when we have it in the local table. */
  rtoOffice: string | null;
  series: string | null;
  serial: string;
}

export interface InsuranceInfo {
  provider: string | null;
  policyNumber: string | null;
  validUpto: string | null;
}

export interface VehicleDetails {
  registrationNumber: string;
  ownerName: string | null;
  makerDescription: string | null;
  makerModel: string | null;
  vehicleClass: string | null;
  fuelType: string | null;
  colour: string | null;
  registrationDate: string | null;
  registeringAuthority: string | null;
  chassisNumber: string | null;
  engineNumber: string | null;
  insurance: InsuranceInfo | null;
  pucValidUpto: string | null;
  fitnessValidUpto: string | null;
  taxValidUpto: string | null;
  rcStatus: string | null;
  financier: string | null;
  isBlacklisted: boolean | null;
}

export interface Challan {
  challanNumber: string;
  challanDate: string | null;
  offences: string[];
  /** Rupees. */
  amount: number;
  status: ChallanStatus;
  location: string | null;
  state: string | null;
  courtName: string | null;
  paymentUrl: string | null;
}

export interface LookupSummary {
  pendingCount: number;
  pendingAmount: number;
  totalCount: number;
}

export interface LookupMeta {
  provider: string;
  privacyMode: PrivacyMode;
  fetchedAt: string;
  cached: boolean;
  /** True when at least one upstream call failed but we still have something to show. */
  partial: boolean;
  warnings: string[];
  elapsedMs: number;
}

export interface LookupResult {
  registrationNumber: string;
  plate: PlateInfo;
  vehicle: VehicleDetails | null;
  challans: Challan[];
  summary: LookupSummary;
  meta: LookupMeta;
}
