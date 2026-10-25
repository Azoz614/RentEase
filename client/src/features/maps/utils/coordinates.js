export const position = (point) =>
  point?.coordinates?.length === 2 &&
  point.coordinates.every(Number.isFinite) &&
  Math.abs(point.coordinates[0]) <= 180 &&
  Math.abs(point.coordinates[1]) <= 90
    ? { lat: point.coordinates[1], lng: point.coordinates[0] }
    : null

export const geoPoint = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] })
