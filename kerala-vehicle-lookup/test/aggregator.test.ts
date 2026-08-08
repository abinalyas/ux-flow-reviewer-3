import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AggregatorProvider,
  DEFAULT_AGGREGATOR_CONFIG,
  mapChallans,
  mapVehicle,
} from '../src/providers/aggregator';
import { ProviderError } from '../src/providers/provider';

const config = {
  ...DEFAULT_AGGREGATOR_CONFIG,
  baseUrl: 'https://vendor.example',
  token: 'test-token',
  timeoutMs: 500,
  maxRetries: 1,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mapVehicle', () => {
  it('maps a snake_case vendor payload', () => {
    const vehicle = mapVehicle(
      {
        data: {
          registration_number: 'KL07BX1234',
          owner_name: 'RAJESH KUMAR NAIR',
          maker_description: 'MARUTI SUZUKI INDIA LTD',
          maker_model: 'SWIFT VDI',
          vehicle_class: 'LMV',
          fuel_type: 'DIESEL',
          registration_date: '2018-04-12',
          vehicle_chasi_number: 'MA3ERLF1S00123456',
          insurance_company: 'ICICI Lombard',
          insurance_upto: '2026-03-31',
          rc_status: 'ACTIVE',
          blacklist_status: 'false',
        },
      },
      'KL07BX1234',
    );

    assert.ok(vehicle);
    assert.equal(vehicle.ownerName, 'RAJESH KUMAR NAIR');
    assert.equal(vehicle.makerModel, 'SWIFT VDI');
    assert.equal(vehicle.chassisNumber, 'MA3ERLF1S00123456');
    assert.equal(vehicle.insurance!.provider, 'ICICI Lombard');
    assert.equal(vehicle.insurance!.validUpto, '2026-03-31');
    assert.equal(vehicle.isBlacklisted, false);
  });

  it('maps a camelCase vendor payload through the same aliases', () => {
    const vehicle = mapVehicle(
      { result: { ownerName: 'ANJALI MENON', fuelType: 'PETROL', vehicleClass: 'LMV' } },
      'KL01AB1111',
    );
    assert.equal(vehicle!.ownerName, 'ANJALI MENON');
    assert.equal(vehicle!.fuelType, 'PETROL');
    // Falls back to the requested plate when the vendor omits it.
    assert.equal(vehicle!.registrationNumber, 'KL01AB1111');
  });

  it('returns null for an empty payload', () => {
    assert.equal(mapVehicle({ data: {} }, 'KL07BX1234'), null);
    assert.equal(mapVehicle(null, 'KL07BX1234'), null);
  });

  it('omits the insurance block when the vendor sends nothing for it', () => {
    assert.equal(mapVehicle({ data: { owner_name: 'X' } }, 'KL07BX1234')!.insurance, null);
  });
});

describe('mapChallans', () => {
  it('maps a list and normalizes statuses', () => {
    const challans = mapChallans({
      data: {
        challans: [
          {
            challan_number: 'KL000111222333',
            challan_date: '2025-06-01',
            amount: '500',
            challan_status: 'Pending',
            offences: [{ name: 'Over speeding' }],
            location: 'NH-66, Edappally',
          },
          { challanNo: 'KL999', amount: 1000, status: 'Cash Paid', offence_details: 'No helmet' },
          { challanNo: 'KL777', amount: 2000, status: 'Sent to Virtual Court' },
        ],
      },
    });

    assert.equal(challans.length, 3);
    assert.equal(challans[0]!.status, 'PENDING');
    assert.equal(challans[0]!.amount, 500);
    assert.deepEqual(challans[0]!.offences, ['Over speeding']);
    assert.equal(challans[1]!.status, 'PAID');
    assert.deepEqual(challans[1]!.offences, ['No helmet']);
    assert.equal(challans[2]!.status, 'IN_COURT');
  });

  it('accepts a bare array and an empty response', () => {
    assert.equal(mapChallans([{ challanNo: 'X', amount: 100 }]).length, 1);
    assert.deepEqual(mapChallans({ data: {} }), []);
    assert.deepEqual(mapChallans(null), []);
  });

  it('parses currency-formatted amounts', () => {
    assert.equal(mapChallans([{ challanNo: 'X', amount: '₹1,500' }])[0]!.amount, 1500);
  });
});

describe('AggregatorProvider', () => {
  it('sends the configured auth header and id field', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    let seenBody = '';

    const provider = new AggregatorProvider(config, async (url, init) => {
      seenUrl = String(url);
      seenAuth = new Headers(init?.headers).get('authorization');
      seenBody = String(init?.body);
      return jsonResponse(200, { data: { owner_name: 'TEST OWNER' } });
    });

    const vehicle = await provider.getVehicle('KL07BX1234');
    assert.equal(seenUrl, 'https://vendor.example/api/v1/rc/rc-full');
    assert.equal(seenAuth, 'Bearer test-token');
    assert.deepEqual(JSON.parse(seenBody), { id_number: 'KL07BX1234' });
    assert.equal(vehicle!.ownerName, 'TEST OWNER');
  });

  it('treats 404 as "no record" rather than an error', async () => {
    const provider = new AggregatorProvider(config, async () => jsonResponse(404, {}));
    assert.equal(await provider.getVehicle('KL07BX1234'), null);
    assert.deepEqual(await provider.getChallans('KL07BX1234'), []);
  });

  it('surfaces bad credentials without retrying', async () => {
    let calls = 0;
    const provider = new AggregatorProvider(config, async () => {
      calls++;
      return jsonResponse(401, {});
    });

    await assert.rejects(
      () => provider.getVehicle('KL07BX1234'),
      (error: unknown) => error instanceof ProviderError && error.code === 'UNAUTHORIZED',
    );
    assert.equal(calls, 1);
  });

  it('retries a 5xx and succeeds on the second attempt', async () => {
    let calls = 0;
    const provider = new AggregatorProvider(config, async () => {
      calls++;
      return calls === 1 ? jsonResponse(503, {}) : jsonResponse(200, { data: { owner_name: 'OK' } });
    });

    assert.equal((await provider.getVehicle('KL07BX1234'))!.ownerName, 'OK');
    assert.equal(calls, 2);
  });

  it('refuses to construct without credentials', () => {
    assert.throws(
      () => new AggregatorProvider({ ...config, token: '' }),
      (error: unknown) => error instanceof ProviderError && error.code === 'NOT_CONFIGURED',
    );
  });
});
