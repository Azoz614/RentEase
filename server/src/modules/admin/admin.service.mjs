export const roles = ['user', 'delivery_partner', 'rental_shop']

export function publicUser(user) {
  const value = user.toObject ? user.toObject() : user
  delete value.password
  return value
}
