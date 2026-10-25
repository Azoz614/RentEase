export const blankAddress = {
  line1: '',
  line2: '',
  city: '',
  district: '',
  province: '',
  postalCode: '',
  country: 'Sri Lanka',
}
export const addressText = (value) =>
  value
    ? [
        value.line1,
        value.line2,
        value.city,
        value.district,
        value.province,
        value.postalCode,
        value.country,
      ]
        .filter(Boolean)
        .join(', ')
    : 'No complete address saved'
