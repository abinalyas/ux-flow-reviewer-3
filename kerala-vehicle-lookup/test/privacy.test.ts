import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyPrivacy, maskIdentifier, maskName, resolvePrivacyMode } from '../src/privacy';
import type { VehicleDetails } from '../src/types';

const vehicle: VehicleDetails = {
  registrationNumber: 'KL07BX1234',
  ownerName: 'RAJESH KUMAR NAIR',
  makerDescription: 'MARUTI SUZUKI INDIA LTD',
  makerModel: 'SWIFT VDI',
  vehicleClass: 'LMV',
  fuelType: 'DIESEL',
  colour: 'WHITE',
  registrationDate: '2018-04-12',
  registeringAuthority: 'RTO Ernakulam',
  chassisNumber: 'MA3ERLF1S00123456',
  engineNumber: 'EN12345678',
  insurance: { provider: 'ICICI Lombard', policyNumber: 'POL987654321', validUpto: '2026-03-31' },
  pucValidUpto: '2026-01-15',
  fitnessValidUpto: null,
  taxValidUpto: '2027-04-11',
  rcStatus: 'ACTIVE',
  financier: 'HDFC BANK LTD',
  isBlacklisted: false,
};

describe('maskName', () => {
  it('keeps the first letter of each token', () => {
    assert.equal(maskName('RAJESH KUMAR NAIR'), 'R***** K**** N***');
  });

  it('passes through null and single characters', () => {
    assert.equal(maskName(null), null);
    assert.equal(maskName('A'), 'A');
  });
});

describe('maskIdentifier', () => {
  it('keeps the last four characters', () => {
    assert.equal(maskIdentifier('MA3ERLF1S00123456'), '*************3456');
  });

  it('leaves short values alone', () => {
    assert.equal(maskIdentifier('1234'), '1234');
  });
});

describe('applyPrivacy', () => {
  it('masks identifying fields in masked mode', () => {
    const masked = applyPrivacy(vehicle, 'masked')!;
    assert.equal(masked.ownerName, 'R***** K**** N***');
    assert.equal(masked.chassisNumber, '*************3456');
    assert.equal(masked.engineNumber, '******5678');
    assert.equal(masked.insurance!.policyNumber, '********4321');
  });

  it('leaves non-identifying fields untouched', () => {
    const masked = applyPrivacy(vehicle, 'masked')!;
    assert.equal(masked.makerModel, 'SWIFT VDI');
    assert.equal(masked.rcStatus, 'ACTIVE');
    assert.equal(masked.insurance!.provider, 'ICICI Lombard');
  });

  it('passes everything through in full mode', () => {
    assert.deepEqual(applyPrivacy(vehicle, 'full'), vehicle);
  });

  it('handles a null vehicle', () => {
    assert.equal(applyPrivacy(null, 'masked'), null);
  });
});

describe('resolvePrivacyMode', () => {
  it('defaults to masked for anything but an explicit "full"', () => {
    assert.equal(resolvePrivacyMode(undefined), 'masked');
    assert.equal(resolvePrivacyMode(''), 'masked');
    assert.equal(resolvePrivacyMode('FULL'), 'masked');
    assert.equal(resolvePrivacyMode('full'), 'full');
  });
});
