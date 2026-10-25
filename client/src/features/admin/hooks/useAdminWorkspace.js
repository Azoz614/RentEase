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
  const [declineTarget, setDeclineTarget] = useState(null)
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

  const api = useMemo(() => createApiClient(token), [token])

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
    const load = async () => {
      try {
        const [
          summary,
          userList,
          productList,
          shopList,
          auditList,
          couponList,
          packageList,
          revenueReport,
        ] = await Promise.all([
          api('/api/admin/overview'),
          api('/api/admin/users'),
          api('/api/admin/products'),
          api('/api/admin/shops/pending'),
          api('/api/admin/audit'),
          api('/api/admin/coupons'),
          api('/api/admin/packages'),
          api('/api/admin/reports/revenue'),
        ])
        if (cancelled) return
        setOverview(summary)
        setUsers(userList.users)
        setProducts(productList.products)
        setShops(shopList.shops)
        setAuditEvents(auditList.events || [])
        setCoupons(couponList.coupons || [])
        setPackages(packageList.packages || [])
        setRevenue(revenueReport)
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      }
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
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    setError('')
    if (files.length > 6) {
      setError('Choose up to 6 photos.')
      event.target.value = ''
      return
    }
    if (
      files.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 2.5 * 1024 * 1024,
      )
    ) {
      setError('Use JPEG, PNG, or WebP photos smaller than 2.5 MB each.')
      event.target.value = ''
      return
    }
    try {
      const encoded = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve({ name: file.name, data: reader.result })
              reader.onerror = reject
              reader.readAsDataURL(file)
            }),
        ),
      )
      setPhotos(encoded)
    } catch {
      setError('Could not read one of those photos.')
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

  const updateUser = (id, data) =>
    runAction(
      () => api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      'Account updated.',
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
  const editProduct = async (event) => {
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
    declineTarget,
    setDeclineTarget,
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
    handlePhotos,
    submitProduct,
    openAddItem,
    submitUser,
    submitCoupon,
    submitPackage,
    updateUser,
    reviewShop,
    visibleProducts,
    visibleUsers,
    exportCsv,
    editProduct,
  }
}
