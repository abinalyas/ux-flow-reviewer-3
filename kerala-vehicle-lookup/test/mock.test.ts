import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockProvider } from '../src/providers/mock';

describe('MockProvider', () => {
  it('is deterministic for the same plate', async () => {
    const a = await new MockProvider().getVehicle('KL07BX1234');
    const b = await new MockProvider().getVehicle('KL07BX1234');
    assert.deepEqual(a, b);
  });

  it('never produces undefined fields, whatever the hash', async () => {
    // Regression: seeds are derived with `>>`, which coerces to int32 and can go
    // negative for hashes above 2^31. A negative modulo index silently yielded
    // undefined for owner, colour, insurer and location.
    const provider = new MockProvider();
    for (let rto = 1; rto <= 14; rto++) {
      for (let n = 0; n < 40; n++) {
        const plate = `KL${String(rto).padStart(2, '0')}AB${String(1000 + n)}`;
        const vehicle = await provider.getVehicle(plate);
        assert.ok(vehicle, `${plate}: no vehicle`);
        assert.equal(typeof vehicle.ownerName, 'string', `${plate}: ownerName`);
        assert.equal(typeof vehicle.colour, 'string', `${plate}: colour`);
        assert.equal(typeof vehicle.makerModel, 'string', `${plate}: makerModel`);
        assert.equal(typeof vehicle.insurance!.provider, 'string', `${plate}: insurer`);

        for (const challan of await provider.getChallans(plate)) {
          assert.equal(typeof challan.location, 'string', `${plate}: location`);
          assert.equal(typeof challan.amount, 'number', `${plate}: amount`);
          assert.ok(challan.offences.every((o) => typeof o === 'string'), `${plate}: offences`);
          assert.ok(!Number.isNaN(challan.amount), `${plate}: amount NaN`);
        }
      }
    }
  });

  it('resolves the reserved plate to no record', async () => {
    const provider = new MockProvider();
    assert.equal(await provider.getVehicle('KL00XX0000'), null);
    assert.deepEqual(await provider.getChallans('KL00XX0000'), []);
  });

  it('returns nothing for unknown plates when synthesis is off', async () => {
    const provider = new MockProvider({ synthesize: false });
    assert.equal(await provider.getVehicle('KL07BX1234'), null);
    assert.deepEqual(await provider.getChallans('KL07BX1234'), []);
  });

  it('rejects a malformed plate', async () => {
    await assert.rejects(() => new MockProvider().getVehicle('nope'));
  });
});
