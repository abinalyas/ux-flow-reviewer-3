import type { PlateInfo } from './types';
import { rtoOffice, stateName } from './rto';

export class InvalidRegistrationNumberError extends Error {
  readonly code = 'INVALID_REGISTRATION_NUMBER';
  constructor(readonly input: string) {
    super(`"${input}" is not a recognisable Indian registration number`);
    this.name = 'InvalidRegistrationNumberError';
  }
}

/** "kl-07 bx 1234" -> "KL07BX1234" */
export function normalize(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** e.g. KL07BX1234, KL7B1234, KL07B1 */
const STANDARD = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;
/** Bharat series, e.g. 22BH1234AA */
const BH_SERIES = /^(\d{2})BH(\d{4})([A-Z]{1,2})$/;

export function parse(input: string): PlateInfo {
  const normalized = normalize(input);
  if (normalized.length < 5 || normalized.length > 11) {
    throw new InvalidRegistrationNumberError(input);
  }

  const bh = BH_SERIES.exec(normalized);
  if (bh) {
    const [, year, serial, suffix] = bh as unknown as [string, string, string, string];
    return {
      normalized,
      formatted: `${year} BH ${serial} ${suffix}`,
      format: 'bh-series',
      stateCode: 'BH',
      stateName: 'Bharat series (national)',
      rtoCode: null,
      rtoOffice: null,
      series: suffix,
      serial,
    };
  }

  const std = STANDARD.exec(normalized);
  if (!std) throw new InvalidRegistrationNumberError(input);

  const [, stateCode, rtoRaw, series, serial] = std as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const rtoCode = rtoRaw.padStart(2, '0');

  return {
    normalized,
    formatted: [stateCode, rtoCode, series, serial].filter(Boolean).join(' '),
    format: 'standard',
    stateCode,
    stateName: stateName(stateCode),
    rtoCode,
    rtoOffice: rtoOffice(stateCode, rtoCode),
    series: series || null,
    serial,
  };
}

export function isValid(input: string): boolean {
  try {
    parse(input);
    return true;
  } catch {
    return false;
  }
}
