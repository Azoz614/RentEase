import { useEffect, useMemo, useState } from 'react'
import { createApiClient } from '../../../services/http.js'
import useProviderRequests from '../../rentals/hooks/useProviderRequests.js'

export default function useAdminWorkspace({ token }) {
  const [section, setSection] = useState('overview')
  const [overview, setOverview] = useState({
    users: 0,
    activeUsers: 0,
    products: 0,
    pendingShops: 0,
    roles: [],
    categories: [],
  })
  const [users, setUsers] = useState([])
  const [products, setProducts] = useState([])
  const [shops, setShops] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [coupons, setCoupons] = useState([])
  const [packages, setPackages] = useState([])
  const [decisionTarget, setDecisionTarget] = useState(null)
  const [revenue, setRevenue] = useState({
    bookings: 0,
    rentalCollected: 0,
    depositsHeld: 0,
    depositsRefunded: 0,
    adjustmentsRetained: 0,
    byDay: [],
  })
  const [photos, setPhotos] = useState([])
  const [newItemType, setNewItemType] = useState('')
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [productSearch, setProductSearch] = useState('')
  const [productStatus, setProductStatus] = useState('all')
  const [userSearch, setUserSearch] = useState('')
  const [userRole, setUserRole] = useState('all')
  const [userStatus, setUserStatus] = useState('all')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [passwordPrompt, setPasswordPrompt] = useState(null)

  // Changes under /api/admin wait for the administrator's password (AdminPasswordDialog).
  // Callers may pass `summary` to describe the change in the dialog; it is not sent.
  const api = useMemo(() => {
    const request = createApiClient(token)
    const confirmed = (url, { summary, ...options } = {}) => {
      if (!url.startsWith('/api/admin/') || !options.method || options.method === 'GET')
        return request(url, options)
      return new Promise((resolve, reject) =>
        setPasswordPrompt({
          summary,
          resolve,
          reject,
          send: (password) =>
            request(url, {
              ...options,
              headers: { ...options.headers, 'X-Admin-Password': encodeURIComponent(password) },
            }),
        }),
      )
    }
    confirmed.stream = request.stream
    return confirmed
  }, [token])

  const {
    requests: rentalRequests,
    loading: requestsLoading,
    error: requestsError,
    refresh: refreshRequests,
  } = useProviderRequests(api, reload)
  const pendingRequests = rentalRequests.filter(
    (request) =>
      ['pending', 'confirmed'].includes(request.status) &&
      request.items.some((item) => item.decision === 'pending'),
  ).length

  useEffect(() => {
    let cancelled = false
    // Each panel loads independently: one failing request must not blank the others.
    const load = async () => {
      const sources = [
        ['/api/admin/overview', setOverview],
        ['/api/admin/users', (body) => setUsers(body.users)],
        ['/api/admin/products', (body) => setProducts(body.products)],
        ['/api/admin/shops/pending', (body) => setShops(body.shops)],
        ['/api/admin/audit', (body) => setAuditEvents(body.events || [])],
        ['/api/admin/coupons', (body) => setCoupons(body.coupons || [])],
        ['/api/admin/packages', (body) => setPackages(body.packages || [])],
        ['/api/admin/reports/revenue', setRevenue],
      ]
      const results = await Promise.allSettled(sources.map(([path]) => api(path)))
      if (cancelled) return
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') sources[index][1](result.value)
      })
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length)
        setError(failures.length === results.length
          ? failures[0].reason.message
          : 'Some dashboard sections could not load. Refresh to try again.')
    }
    load()
    return () => {
      cancelled = true
    }
  }, [api, reload])

  const runAction = async (action, success) => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await action()
      setMessage(success)
      setReload((value) => value + 1)
    } catch (actionError) {
      if (!actionError.cancelled) setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const submitProduct = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const itemType = newItemType === 'vehicle' ? 'Vehicle' : 'Asset'
    const detailFields =
      newItemType === 'vehicle'
        ? [
            ['Make', form.get('make')],
            ['Model', form.get('model')],
            ['Registration number', form.get('registration')],
            ['Fuel type', form.get('fuelType')],
            ['Seats', form.get('seats')],
          ]
        : [
            ['Asset category', form.get('assetCategory')],
            ['Brand / model', form.get('brandModel')],
            ['Condition', form.get('condition')],
            ['Asset ID', form.get('assetId')],
          ]
    const specifications = [['Item type', itemType], ...detailFields]
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([name, value]) => ({ name, value: value.trim() }))
    await runAction(async () => {
      await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          category: itemType === 'Vehicle' ? 'Vehicles' : 'Assets',
          description: form.get('description'),
          dailyRate: form.get('dailyRate'),
          leadTimeHours: form.get('leadTimeHours'),
          providerId: form.get('providerId'),
          specifications,
          photos: photos.map((photo) => photo.data),
        }),
      })
      formElement.reset()
      setPhotos([])
      setNewItemType('')
      setAddItemOpen(false)
    }, 'Product published in Batticaloa.')
  }

  const openAddItem = () => {
    setPhotos([])
    setNewItemType('')
    setAddItemOpen(true)
  }

  const submitUser = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      })
      formElement.reset()
    }, 'Account created.')
  }

  const submitCoupon = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      })
      formElement.reset()
    }, 'Coupon created.')
  }

  const submitPackage = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          category: form.get('category'),
          description: form.get('description'),
          dailyRate: form.get('dailyRate'),
          weeklyRate: form.get('weeklyRate'),
          startsAt: form.get('startsAt'),
          endsAt: form.get('endsAt'),
          productIds: form.getAll('productIds'),
          optionalAddOnIds: form.getAll('optionalAddOnIds'),
        }),
      })
      formElement.reset()
    }, 'Rental package created.')
  }

  const updateUser = (id, data, summary) =>
    runAction(
      () =>
        api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data), summary }),
      data.active === false ? 'Account put on hold.' : data.active ? 'Account released from hold.' : 'Account updated.',
    )
  const deleteUser = (account) =>
    runAction(
      () =>
        api(`/api/admin/users/${account._id}`, {
          method: 'DELETE',
          summary: `Permanently delete ${account.username}? This cannot be undone.`,
        }),
      `Account ${account.username} deleted.`,
    )
  const holdProduct = (product) =>
    runAction(
      () =>
        api(`/api/admin/products/${product._id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !product.active }),
          summary: product.active
            ? `Put ${product.title} on hold? Customers can no longer book it.`
            : `Release ${product.title} from hold and list it again?`,
        }),
      product.active ? 'Listing put on hold.' : 'Listing released from hold.',
    )
  const deleteProduct = (product) =>
    runAction(
      () =>
        api(`/api/admin/products/${product._id}`, {
          method: 'DELETE',
          summary: `Permanently delete ${product.title} and its photos? This cannot be undone.`,
        }),
      `${product.title} deleted.`,
    )
  const reviewShop = (id, decision) =>
    runAction(
      () =>
        api(`/api/admin/shops/${id}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ decision }),
        }),
      decision === 'approved' ? 'Rental shop approved.' : 'Shop application declined.',
    )

  const visibleProducts = products.filter((product) => {
    const matchesText = `${product.title} ${product.category} ${product.location}`
      .toLowerCase()
      .includes(productSearch.toLowerCase())
    return (
      matchesText && (productStatus === 'all' || (productStatus === 'active') === product.active)
    )
  })
  const visibleUsers = users.filter((account) => {
    const matchesText = `${account.username} ${account.email} ${account.phone}`
      .toLowerCase()
      .includes(userSearch.toLowerCase())
    return (
      matchesText &&
      (userRole === 'all' || account.role === userRole) &&
      (userStatus === 'all' || (userStatus === 'active') === account.active)
    )
  })
  const exportCsv = (filename, rows) => {
    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            let cell = String(value ?? '')
            if (/^[=+\-@]/.test(cell)) cell = `'${cell}`
            return `"${cell.replaceAll('"', '""')}"`
          })
          .join(','),
      )
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }
  const editProduct = async (event, productPhotos) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runAction(async () => {
      await api(`/api/admin/products/${editingProduct._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.get('title'),
          category: form.get('category'),
          description: form.get('description'),
          dailyRate: form.get('dailyRate'),
          photos: productPhotos,
        }),
      })
      setEditingProduct(null)
    }, 'Product details saved.')
  }

  return {
    section,
    setSection,
    overview,
    users,
    products,
    shops,
    auditEvents,
    coupons,
    packages,
    decisionTarget,
    setDecisionTarget,
    revenue,
    photos,
    setPhotos,
    newItemType,
    setNewItemType,
    addItemOpen,
    setAddItemOpen,
    editingProduct,
    setEditingProduct,
    productSearch,
    setProductSearch,
    productStatus,
    setProductStatus,
    userSearch,
    setUserSearch,
    userRole,
    setUserRole,
    userStatus,
    setUserStatus,
    message,
    setMessage,
    error,
    setError,
    busy,
    reload,
    setReload,
    api,
    rentalRequests,
    requestsLoading,
    requestsError,
    refreshRequests,
    pendingRequests,
    runAction,
    submitProduct,
    openAddItem,
    submitUser,
    submitCoupon,
    submitPackage,
    updateUser,
    deleteUser,
    holdProduct,
    deleteProduct,
    passwordPrompt,
    setPasswordPrompt,
    reviewShop,
    visibleProducts,
    visibleUsers,
    exportCsv,
    editProduct,
  }
}
