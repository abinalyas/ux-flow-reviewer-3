import { InvalidRegistrationNumberError } from './regno';
import { createProvider, ProviderError } from './providers';
import { LookupService } from './service';
import type { LookupResult } from './types';

function formatCurrency(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function render(result: LookupResult): string {
  const lines: string[] = [];
  const { plate, vehicle, challans, summary, meta } = result;

  lines.push('');
  lines.push(`  ${plate.formatted}`);
  lines.push(`  ${'─'.repeat(Math.max(plate.formatted.length, 24))}`);
  lines.push(`  Registering office : ${plate.rtoOffice ?? 'Unknown (not in local RTO table)'}`);
  lines.push(`  State              : ${plate.stateName ?? plate.stateCode}`);

  if (vehicle) {
    lines.push('');
    lines.push('  Vehicle');
    lines.push(`    Owner        : ${vehicle.ownerName ?? '—'}`);
    lines.push(`    Model        : ${[vehicle.makerDescription, vehicle.makerModel].filter(Boolean).join(' ') || '—'}`);
    lines.push(`    Class / fuel : ${vehicle.vehicleClass ?? '—'} / ${vehicle.fuelType ?? '—'}`);
    lines.push(`    Registered   : ${vehicle.registrationDate ?? '—'}`);
    lines.push(`    RC status    : ${vehicle.rcStatus ?? '—'}`);
    lines.push(`    Insurance    : ${vehicle.insurance?.provider ?? '—'} (valid to ${vehicle.insurance?.validUpto ?? '—'})`);
    lines.push(`    PUC valid to : ${vehicle.pucValidUpto ?? '—'}`);
  } else {
    lines.push('');
    lines.push('  Vehicle        : no record returned');
  }

  lines.push('');
  if (challans.length === 0) {
    lines.push('  Challans       : none returned');
  } else {
    lines.push(`  Challans (${challans.length})`);
    for (const challan of challans) {
      lines.push(
        `    ${challan.status.padEnd(9)} ${formatCurrency(challan.amount).padStart(9)}  ` +
          `${challan.challanDate ?? '—'}  ${challan.offences.join(', ') || '—'}`,
      );
      if (challan.location) lines.push(`              ${challan.location}`);
    }
    lines.push('');
    lines.push(`  Pending: ${summary.pendingCount} challan(s), ${formatCurrency(summary.pendingAmount)}`);
  }

  lines.push('');
  lines.push(
    `  [provider=${meta.provider} privacy=${meta.privacyMode} cached=${meta.cached} ${meta.elapsedMs}ms]`,
  );
  if (meta.provider === 'mock') {
    lines.push('  [mock provider — synthetic data, not a real lookup]');
  }
  for (const warning of meta.warnings) lines.push(`  ! ${warning}`);
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const input = args.find((arg) => !arg.startsWith('--'));

  if (!input) {
    console.error('usage: npm run lookup -- <registration-number> [--json]');
    console.error('example: npm run lookup -- KL07BX1234');
    process.exitCode = 2;
    return;
  }

  try {
    const service = new LookupService(createProvider());
    const result = await service.lookup(input);
    console.log(asJson ? JSON.stringify(result, null, 2) : render(result));
  } catch (error) {
    if (error instanceof InvalidRegistrationNumberError) {
      console.error(`Invalid registration number: ${error.input}`);
    } else if (error instanceof ProviderError) {
      console.error(`Provider error [${error.code}]: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

void main();
