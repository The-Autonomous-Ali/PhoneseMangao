/** A point on the earth. Degrees, as a browser's geolocation API reports them. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Mean earth radius. Good to about 0.5% at city scale, far inside a delivery radius. */
const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * The haversine rather than the shorter spherical law of cosines, which is
 * algebraically equivalent but computes `cos(a)cos(b) + ...` and then takes an
 * arccos of a value very close to 1 for nearby points. That is exactly the
 * range this function is used in — a delivery radius is a few kilometres — and
 * it is where the cosine formula loses precision to floating point, reporting
 * a neighbouring street as zero metres away.
 *
 * Treating the earth as a sphere costs about half a percent against the true
 * ellipsoid. Over 5 km that is 25 metres, which is smaller than the error in
 * where somebody drops a pin.
 */
export function distanceKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
