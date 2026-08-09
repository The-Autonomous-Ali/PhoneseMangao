import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { servicePincode: { findFirst: vi.fn() } },
}));

import { db } from '@/lib/db';
import { isServiceable, isValidPincode } from './serviceability';

beforeEach(() => {
  vi.mocked(db.servicePincode.findFirst).mockReset().mockResolvedValue(null);
});

describe('isValidPincode', () => {
  it.each(['110001', '400072', '682001'])('accepts %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(true);
  });

  it('rejects a leading zero, which no Indian PIN code has', () => {
    expect(isValidPincode('012345')).toBe(false);
  });

  it.each(['1234', '1234567', 'abcdef', '', '11 001'])('rejects %s', (pincode) => {
    expect(isValidPincode(pincode)).toBe(false);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(isValidPincode('  110001  ')).toBe(true);
  });
});

describe('isServiceable', () => {
  it('is serviceable when an active pincode row exists', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: 'Andheri East' } as never);

    await expect(isServiceable({ pincode: '400069' })).resolves.toEqual({
      serviceable: true,
      area: 'Andheri East',
    });
  });

  it('omits the area when the shop has not recorded one', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: null } as never);

    await expect(isServiceable({ pincode: '400069' })).resolves.toEqual({ serviceable: true });
  });

  it('is not serviceable when no row matches', async () => {
    await expect(isServiceable({ pincode: '999999' })).resolves.toEqual({ serviceable: false });
  });

  it('only counts pincodes the shop has left switched on', async () => {
    await isServiceable({ pincode: '400069' });

    expect(db.servicePincode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pincode: '400069', isActive: true } })
    );
  });

  it('rejects a malformed pincode without querying', async () => {
    await expect(isServiceable({ pincode: 'abc' })).resolves.toEqual({ serviceable: false });
    expect(db.servicePincode.findFirst).not.toHaveBeenCalled();
  });

  it('trims before looking up, so a pasted value still matches', async () => {
    vi.mocked(db.servicePincode.findFirst).mockResolvedValue({ area: null } as never);

    await isServiceable({ pincode: ' 400069 ' });

    expect(db.servicePincode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pincode: '400069', isActive: true } })
    );
  });
});
