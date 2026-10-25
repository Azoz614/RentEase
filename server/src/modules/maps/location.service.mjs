import mongoose from 'mongoose'

export const locationError = (status, message) => Object.assign(new Error(message), { status })
export function point(value) {
  const coordinates =
    value?.type === 'Point' ? value.coordinates : [value?.longitude, value?.latitude]
  if (
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !coordinates.every(Number.isFinite) ||
    Math.abs(coordinates[0]) > 180 ||
    Math.abs(coordinates[1]) > 90
  )
    throw locationError(400, 'Choose a valid location on the map.')
  return { type: 'Point', coordinates: [...coordinates] }
}
export const latLng = (value) => {
  const p = point(value)
  return { latitude: p.coordinates[1], longitude: p.coordinates[0] }
}
export const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator(value) {
          try {
            point({ type: 'Point', coordinates: value })
            return true
          } catch {
            return false
          }
        },
        message: 'Invalid longitude/latitude.',
      },
    },
  },
  { _id: false },
)
