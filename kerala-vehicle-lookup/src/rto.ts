/**
 * Kerala RTO codes.
 *
 * IMPORTANT: only the 14 district RTOs are listed here, because those are the
 * ones we can state with confidence. Kerala also has a large number of sub-RTOs
 * (KL-15 and up, currently into the KL-80s) and that list changes as offices are
 * added or reorganised. Rather than ship a half-remembered table that would
 * confidently mislabel a plate, unknown codes resolve to `null` and the caller
 * shows "Unknown RTO".
 *
 * To complete this table, source it from the MVD Kerala offices page
 * (https://mvd.kerala.gov.in) and extend the map below. Do not fill it in from
 * memory or from an AI summary — the sub-RTO assignments are exactly the kind of
 * detail that gets fabricated.
 */

const KERALA_DISTRICT_RTOS: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Thiruvananthapuram',
  '02': 'Kollam',
  '03': 'Pathanamthitta',
  '04': 'Alappuzha',
  '05': 'Kottayam',
  '06': 'Idukki',
  '07': 'Ernakulam',
  '08': 'Thrissur',
  '09': 'Palakkad',
  '10': 'Malappuram',
  '11': 'Kozhikode',
  '12': 'Wayanad',
  '13': 'Kannur',
  '14': 'Kasaragod',
});

/** A deliberately small map — extend as needed. */
const STATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  KL: 'Kerala',
  KA: 'Karnataka',
  TN: 'Tamil Nadu',
  AP: 'Andhra Pradesh',
  TS: 'Telangana',
  MH: 'Maharashtra',
  DL: 'Delhi',
  PY: 'Puducherry',
});

export function stateName(stateCode: string): string | null {
  return STATE_NAMES[stateCode.toUpperCase()] ?? null;
}

/**
 * Registering office for a state + RTO serial, or null when we do not have a
 * verified entry. Null means "unknown", never "does not exist".
 */
export function rtoOffice(stateCode: string, rtoCode: string | null): string | null {
  if (!rtoCode) return null;
  if (stateCode.toUpperCase() !== 'KL') return null;
  const padded = rtoCode.padStart(2, '0');
  return KERALA_DISTRICT_RTOS[padded] ?? null;
}

export function isKerala(stateCode: string): boolean {
  return stateCode.toUpperCase() === 'KL';
}
