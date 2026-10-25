export const stages = [
  'assigned',
  'heading_to_shop',
  'arrived_at_shop',
  'picked_up',
  'on_the_way',
  'delivered',
  'return_pickup',
  'heading_to_customer',
  'collected',
  'returning',
  'returned',
]

export const label = (value) =>
  ({
    on_the_way: 'Heading to customer',
    return_pickup: 'Return collection assigned',
    heading_to_customer: 'Heading to return collection',
    returning: 'Heading to rental shop',
    returned: 'Returned to shop',
    picked_up: 'Item picked up',
    collected: 'Item collected',
  })[value] || value?.replaceAll('_', ' ')
