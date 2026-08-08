import type { PrivacyMode, VehicleDetails } from './types';

/**
 * Data minimisation helpers.
 *
 * The default posture is `masked`, matching what the public VAHAN portal itself
 * returns since the DPDP Act, 2023: enough to confirm you are looking at the
 * right vehicle, not enough to identify or trace its owner. `full` should only
 * be switched on when you have a lawful basis for the unmasked fields — see
 * README "Legal and privacy".
 */

/** "RAJESH KUMAR NAIR" -> "R***** K***** N***" */
export function maskName(value: string | null): string | null {
  if (!value) return value;
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.length <= 1) return token;
      return token[0] + '*'.repeat(token.length - 1);
    })
    .join(' ');
}

/** Keeps the last `visible` characters: "MA3ERLF1S00123456" -> "*************3456" */
export function maskIdentifier(value: string | null, visible = 4): string | null {
  if (!value) return value;
  const trimmed = value.trim();
  if (trimmed.length <= visible) return trimmed;
  return '*'.repeat(trimmed.length - visible) + trimmed.slice(-visible);
}

export function applyPrivacy(
  vehicle: VehicleDetails | null,
  mode: PrivacyMode,
): VehicleDetails | null {
  if (!vehicle || mode === 'full') return vehicle;
  return {
    ...vehicle,
    ownerName: maskName(vehicle.ownerName),
    chassisNumber: maskIdentifier(vehicle.chassisNumber),
    engineNumber: maskIdentifier(vehicle.engineNumber),
    insurance: vehicle.insurance
      ? { ...vehicle.insurance, policyNumber: maskIdentifier(vehicle.insurance.policyNumber) }
      : null,
  };
}

export function resolvePrivacyMode(raw: string | undefined): PrivacyMode {
  return raw === 'full' ? 'full' : 'masked';
}
