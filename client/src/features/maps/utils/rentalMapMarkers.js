import { formatCurrency } from '../../../utils/currency.js'
import { position } from './coordinates.js'

export function rentalCategoryIcon(category = '') {
  if (/camera|photo|electronic/i.test(category)) return 'camera'
  if (/vehicle|car|motor|transport/i.test(category)) return 'vehicle'
  if (/tool|construct|equipment/i.test(category)) return 'tools'
  if (/sport|travel|camp|outdoor/i.test(category)) return 'outdoors'
  if (/event|space|party/i.test(category)) return 'events'
  return 'box'
}

// Group exact shared coordinates instead of moving markers away from their real location.
export function rentalMapMarkers(products) {
  const groups = new Map()
  for (const product of products) {
    const location = product.shop?.shopLocation
    const point = position(location)
    if (!point) continue
    const key = `${point.lng},${point.lat}`
    if (!groups.has(key)) groups.set(key, { id: `rentals:${key}`, kind: 'rental', location, products: [] })
    groups.get(key).products.push({
      id: product._id,
      title: product.title,
      category: product.category,
      photo: product.photos?.[0],
      price: formatCurrency(product.dailyRate),
      dailyRate: Number(product.dailyRate || 0),
      shopName: product.shop.shopName || product.shop.username || 'Rental shop',
    })
  }
  return [...groups.values()].map((group) => {
    const sorted = [...group.products].sort((a, b) => a.dailyRate - b.dailyRate)
    const multiple = sorted.length > 1
    return {
      ...group,
      products: sorted,
      icon: sorted.every((product) => rentalCategoryIcon(product.category) === rentalCategoryIcon(sorted[0].category)) ? rentalCategoryIcon(sorted[0].category) : 'box',
      label: `${multiple ? 'From ' : ''}${sorted[0].price}`,
      title: multiple ? `${sorted.length} rental items · from ${sorted[0].price} per day. Choose an item.` : `View ${sorted[0].title} · ${sorted[0].price} per day`,
    }
  })
}

const iconPaths = {
  camera: ['M4 7h4l2-3h4l2 3h4v13H4Z', 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  vehicle: ['M3 17V11l3-6h12l3 6v6H3Zm0-6h18M6 17v3m12-3v3M6 14h2m8 0h2'],
  tools: ['m14 6 4-4a7 7 0 0 0-8 9L3 18a2 2 0 0 0 3 3l7-7a7 7 0 0 0 9-8l-4 4Z'],
  outdoors: ['m2 20 10-17 10 17H2Zm10-9 6 9H6Z'],
  events: ['m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'],
  box: ['m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4M12 11v10'],
}

// Leaflet treats HTML strings as markup; use DOM/textContent for all listing data.
export function createRentalPin(entry, selected) {
  const pin = document.createElement('span')
  pin.className = `re-rental-pin${selected ? ' is-selected' : ''}`
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  for (const path of iconPaths[entry.icon] || iconPaths.box) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    shape.setAttribute('d', path)
    icon.append(shape)
  }
  const label = document.createElement('span')
  label.textContent = entry.label
  pin.append(icon, label)
  if (entry.products.length > 1) {
    const count = document.createElement('b')
    count.className = 're-rental-pin-count'
    count.textContent = entry.products.length
    pin.append(count)
  }
  return pin
}

export function createRentalPopup(entry, onView) {
  const popup = document.createElement('div')
  popup.className = 're-rental-popup'
  const heading = document.createElement('strong')
  heading.textContent = `${entry.products.length} items at this location`
  popup.append(heading)
  const list = document.createElement('div')
  list.className = 're-rental-popup-list'
  for (const product of entry.products) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 're-rental-popup-product'
    button.setAttribute('aria-label', `View ${product.title} · ${product.price} per day`)
    if (product.photo) {
      const photo = document.createElement('img')
      photo.src = product.photo
      photo.alt = ''
      photo.loading = 'lazy'
      photo.addEventListener('error', () => { photo.hidden = true })
      button.append(photo)
    }
    const copy = document.createElement('span')
    const title = document.createElement('b')
    title.textContent = product.title
    const shop = document.createElement('small')
    shop.textContent = product.shopName
    const price = document.createElement('strong')
    price.textContent = `${product.price} / day ↗`
    copy.append(title, shop, price)
    button.append(copy)
    button.addEventListener('click', () => onView(product.id))
    list.append(button)
  }
  popup.append(list)
  return popup
}
