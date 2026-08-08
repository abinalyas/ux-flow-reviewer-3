import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidRegistrationNumberError, isValid, normalize, parse } from '../src/regno';

describe('normalize', () => {
  it('strips separators and upper-cases', () => {
    assert.equal(normalize('kl-07 bx 1234'), 'KL07BX1234');
    assert.equal(normalize('KL 07 BX 1234'), 'KL07BX1234');
  });
});

describe('parse', () => {
  it('parses a standard Kerala plate', () => {
    const plate = parse('KL07BX1234');
    assert.equal(plate.format, 'standard');
    assert.equal(plate.stateCode, 'KL');
    assert.equal(plate.stateName, 'Kerala');
    assert.equal(plate.rtoCode, '07');
    assert.equal(plate.rtoOffice, 'Ernakulam');
    assert.equal(plate.series, 'BX');
    assert.equal(plate.serial, '1234');
    assert.equal(plate.formatted, 'KL 07 BX 1234');
  });

  it('pads a single-digit RTO code', () => {
    assert.equal(parse('KL7B1234').rtoCode, '07');
  });

  it('resolves each district RTO', () => {
    assert.equal(parse('KL01A1').rtoOffice, 'Thiruvananthapuram');
    assert.equal(parse('KL11AA1').rtoOffice, 'Kozhikode');
    assert.equal(parse('KL14Z9999').rtoOffice, 'Kasaragod');
  });

  it('returns null rather than guessing for sub-RTO codes', () => {
    // KL-41 is a real sub-RTO, but it is deliberately not in the local table.
    assert.equal(parse('KL41AB1234').rtoOffice, null);
  });

  it('does not claim an RTO office for other states', () => {
    const plate = parse('KA05MH1234');
    assert.equal(plate.stateName, 'Karnataka');
    assert.equal(plate.rtoOffice, null);
  });

  it('parses BH-series plates', () => {
    const plate = parse('22BH1234AA');
    assert.equal(plate.format, 'bh-series');
    assert.equal(plate.stateCode, 'BH');
    assert.equal(plate.rtoCode, null);
    assert.equal(plate.serial, '1234');
    assert.equal(plate.formatted, '22 BH 1234 AA');
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'ABC', '1234', 'KL', 'KLKLKLKL', 'KL07BX12345678']) {
      assert.throws(() => parse(bad), InvalidRegistrationNumberError, `expected reject: ${bad}`);
    }
  });

  it('isValid mirrors parse', () => {
    assert.equal(isValid('KL07BX1234'), true);
    assert.equal(isValid('nope'), false);
  });
});
