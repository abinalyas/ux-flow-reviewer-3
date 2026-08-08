import type { Challan, VehicleDetails } from '../types';

export type ProviderErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { code: ProviderErrorCode; status?: number; retryable?: boolean },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = opts.code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/**
 * The seam every data source sits behind.
 *
 * Two calls rather than one because they are separately priced and separately
 * flaky upstream: challan lookups fail far more often than RC lookups, and a
 * challan failure should never cost you the vehicle details you already paid for.
 */
export interface VehicleDataProvider {
  readonly name: string;
  /** Resolves to null when the plate is well-formed but unknown to the source. */
  getVehicle(registrationNumber: string): Promise<VehicleDetails | null>;
  getChallans(registrationNumber: string): Promise<Challan[]>;
}
