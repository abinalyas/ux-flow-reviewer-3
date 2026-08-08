import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockProvider } from '../src/providers/mock';
import { ProviderError, type VehicleDataProvider } from '../src/providers/provider';
import { InvalidRegistrationNumberError } from '../src/regno';
import { LookupService, summarize } from '../src/service';
import type { Challan, VehicleDetails } from '../src/types';

const challan = (over: Partial<Challan>): Challan => ({
  challanNumber: 'X',
  challanDate: '2025-01-01',
  offences: ['Over speeding'],
  amount: 500,
  status: 'PENDING',
  location: null,
  state: 'KL',
  courtName: null,
  paymentUrl: null,
  ...over,
});

describe('summarize', () => {
  it('counts pending and in-court challans as outstanding', () => {
    const summary = summarize([
      challan({ status: 'PENDING', amount: 500 }),
      challan({ status: 'IN_COURT', amount: 1000 }),
      challan({ status: 'PAID', amount: 2000 }),
    ]);
    assert.deepEqual(summary, { pendingCount: 2, pendingAmount: 1500, totalCount: 3 });
  });

  it('handles an empty list', () => {
    assert.deepEqual(summarize([]), { pendingCount: 0, pendingAmount: 0, totalCount: 0 });
  });
});

describe('LookupService', () => {
  it('rejects a malformed plate before touching the provider', async () => {
    let called = false;
    const provider: VehicleDataProvider = {
      name: 'spy',
      async getVehicle() {
        called = true;
        return null;
      },
      async getChallans() {
        called = true;
        return [];
      },
    };

    await assert.rejects(
      () => new LookupService(provider).lookup('not-a-plate'),
      InvalidRegistrationNumberError,
    );
    assert.equal(called, false);
  });

  it('returns deterministic results from the mock provider', async () => {
    const service = new LookupService(new MockProvider());
    const first = await service.lookup('kl-07 bx 1234');
    const second = await new LookupService(new MockProvider()).lookup('KL07BX1234');

    assert.equal(first.registrationNumber, 'KL07BX1234');
    assert.equal(first.plate.rtoOffice, 'Ernakulam');
    assert.deepEqual(first.vehicle, second.vehicle);
    assert.deepEqual(first.challans, second.challans);
  });

  it('masks owner details by default', async () => {
    const result = await new LookupService(new MockProvider()).lookup('KL07BX1234');
    assert.match(result.vehicle!.ownerName!, /\*/);
    assert.equal(result.meta.privacyMode, 'masked');
  });

  it('leaves owner details intact when privacy mode is full', async () => {
    const result = await new LookupService(new MockProvider(), { privacyMode: 'full' }).lookup(
      'KL07BX1234',
    );
    assert.doesNotMatch(result.vehicle!.ownerName!, /\*/);
  });

  it('degrades to partial when only the challan call fails', async () => {
    const provider: VehicleDataProvider = {
      name: 'half-broken',
      async getVehicle() {
        return { registrationNumber: 'KL07BX1234', ownerName: 'TEST OWNER' } as VehicleDetails;
      },
      async getChallans(): Promise<Challan[]> {
        throw new ProviderError('challan service down', { code: 'UPSTREAM_ERROR' });
      },
    };

    const result = await new LookupService(provider).lookup('KL07BX1234');
    assert.ok(result.vehicle);
    assert.deepEqual(result.challans, []);
    assert.equal(result.meta.partial, true);
    assert.equal(result.meta.warnings.length, 1);
    assert.match(result.meta.warnings[0]!, /Challan details unavailable/);
  });

  it('throws when both upstream calls fail', async () => {
    const provider: VehicleDataProvider = {
      name: 'broken',
      async getVehicle(): Promise<VehicleDetails | null> {
        throw new ProviderError('rc down', { code: 'UPSTREAM_ERROR' });
      },
      async getChallans(): Promise<Challan[]> {
        throw new ProviderError('challan down', { code: 'UPSTREAM_ERROR' });
      },
    };

    await assert.rejects(() => new LookupService(provider).lookup('KL07BX1234'), ProviderError);
  });

  it('serves a repeat lookup from cache without a second upstream call', async () => {
    let calls = 0;
    const provider: VehicleDataProvider = {
      name: 'counting',
      async getVehicle() {
        calls++;
        return { registrationNumber: 'KL07BX1234' } as VehicleDetails;
      },
      async getChallans() {
        return [];
      },
    };

    const service = new LookupService(provider, { cacheTtlMs: 60_000 });
    const first = await service.lookup('KL07BX1234');
    const second = await service.lookup('kl 07 bx 1234');

    assert.equal(calls, 1);
    assert.equal(first.meta.cached, false);
    assert.equal(second.meta.cached, true);
  });

  it('re-fetches once the cache entry expires', async () => {
    let calls = 0;
    let clock = 1_000;
    const provider: VehicleDataProvider = {
      name: 'counting',
      async getVehicle() {
        calls++;
        return { registrationNumber: 'KL07BX1234' } as VehicleDetails;
      },
      async getChallans() {
        return [];
      },
    };

    const service = new LookupService(provider, { cacheTtlMs: 1_000, now: () => clock });
    await service.lookup('KL07BX1234');
    clock += 5_000;
    const second = await service.lookup('KL07BX1234');

    assert.equal(calls, 2);
    assert.equal(second.meta.cached, false);
  });

  it('reports a well-formed but unknown plate as an empty record', async () => {
    const result = await new LookupService(new MockProvider()).lookup('KL00XX0000');
    assert.equal(result.vehicle, null);
    assert.deepEqual(result.challans, []);
    assert.equal(result.meta.partial, false);
  });
});
