import { describe, it, expect } from 'vitest';
import { distanceKm, isValidLatitude, isValidLongitude } from './geo';

/** The shop, near Indiranagar. Used as a fixed origin throughout. */
const SHOP = { lat: 12.9784, lng: 77.6408 };

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(SHOP, SHOP)).toBe(0);
  });

  it('measures one degree of latitude as 111.19 km', () => {
    // A degree of latitude is the same length everywhere, which makes it the
    // one distance that can be checked against a known constant rather than
    // against whatever the implementation happens to produce.
    const north = { lat: SHOP.lat + 1, lng: SHOP.lng };

    expect(distanceKm(SHOP, north)).toBeCloseTo(111.19, 1);
  });

  it('is symmetric', () => {
    const other = { lat: 12.9352, lng: 77.6245 };

    expect(distanceKm(SHOP, other)).toBeCloseTo(distanceKm(other, SHOP), 6);
  });

  it('measures a real city-scale distance', () => {
    // Indiranagar to Koramangala, about 5 km by the map.
    const koramangala = { lat: 12.9352, lng: 77.6245 };

    const km = distanceKm(SHOP, koramangala);

    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(6);
  });

  it('measures a distance well outside any delivery radius', () => {
    // Bengaluru to Mysuru, about 126 km.
    const mysuru = { lat: 12.2958, lng: 76.6394 };

    expect(distanceKm(SHOP, mysuru)).toBeGreaterThan(100);
  });

  it('handles a very short hop without losing precision', () => {
    // Roughly 111 m north. The naive formula that squares a difference of
    // cosines loses this in floating point; the haversine does not.
    const nextStreet = { lat: SHOP.lat + 0.001, lng: SHOP.lng };

    expect(distanceKm(SHOP, nextStreet)).toBeCloseTo(0.111, 2);
  });
});

describe('isValidLatitude / isValidLongitude', () => {
  it.each([[0], [12.9784], [90], [-90]])('accepts latitude %s', (value) => {
    expect(isValidLatitude(value)).toBe(true);
  });

  it.each([[90.1], [-90.1], [NaN], [Infinity]])('rejects latitude %s', (value) => {
    expect(isValidLatitude(value)).toBe(false);
  });

  it.each([[0], [77.6408], [180], [-180]])('accepts longitude %s', (value) => {
    expect(isValidLongitude(value)).toBe(true);
  });

  it.each([[180.1], [-180.1], [NaN], [Infinity]])('rejects longitude %s', (value) => {
    expect(isValidLongitude(value)).toBe(false);
  });
});
