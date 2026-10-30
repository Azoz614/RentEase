import { useCallback, useEffect, useRef } from 'react'

export const productIdFromUrl = () => new URLSearchParams(window.location.search).get('product')
const urlWithProduct = (id) => {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set('product', id)
  else params.delete('product')
  const query = params.toString()
  return `${window.location.pathname}${query ? `?${query}` : ''}`
}

// The product page lives in ?product= so Back returns to the listings and a refresh or shared
// link reopens the same item once the catalog has loaded.
export default function useProductRoute({ products, selectedId, show, hide }) {
  const latest = useRef({ products, show, hide })
  useEffect(() => {
    latest.current = { products, show, hide }
  })
  useEffect(() => {
    const onPopState = () => {
      const id = productIdFromUrl()
      const { products: current, show: open, hide: close } = latest.current
      const product = id && current.find((entry) => entry._id === id)
      if (product) open(product)
      else close()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    const id = productIdFromUrl()
    const product = !selectedId && id && products.find((entry) => entry._id === id)
    if (!product) return
    let active = true
    queueMicrotask(() => {
      if (active) latest.current.show(product)
    })
    return () => {
      active = false
    }
  }, [products, selectedId])

  const open = useCallback((product) => {
    if (productIdFromUrl() !== product._id)
      window.history.pushState({ productId: product._id }, '', urlWithProduct(product._id))
    latest.current.show(product)
  }, [])
  const close = useCallback(() => {
    // Opened from the listings: step back so Forward still works. Opened from a link: replace.
    if (window.history.state?.productId) window.history.back()
    else {
      window.history.replaceState({}, '', urlWithProduct(null))
      latest.current.hide()
    }
  }, [])
  return { open, close }
}
