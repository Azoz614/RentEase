import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import useAdminWorkspace from '../hooks/useAdminWorkspace.js'
import OverviewPanel from '../components/OverviewPanel.jsx'
import ProductsPanel from '../components/ProductsPanel.jsx'
import PackagesPanel from '../components/PackagesPanel.jsx'
import RentalRequestsPanel from '../components/RentalRequestsPanel.jsx'
import UsersPanel from '../components/UsersPanel.jsx'
import ShopApprovalsPanel from '../components/ShopApprovalsPanel.jsx'
import ReportsPanel from '../components/ReportsPanel.jsx'
import PromotionsPanel from '../components/PromotionsPanel.jsx'
import ActivityPanel from '../components/ActivityPanel.jsx'
import EditProductDialog from '../components/EditProductDialog.jsx'
import CreateProductDialog from '../components/CreateProductDialog.jsx'
import AdminPasswordDialog from '../components/AdminPasswordDialog.jsx'
import '../styles/admin.css'

import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { WorkspaceNav } from '../../../components/ui/WorkspaceNav.jsx'
import { DeliveryWorkspace } from '../../maps/components/DeliveryWorkspace.jsx'
import { DeliveryPricing } from '../../maps/components/DeliveryPricing.jsx'
import { ShopLocation } from '../../maps/components/ShopLocation.jsx'
import RentalHandover from '../../rentals/pages/RentalHandover.jsx'
import CustomerVerifications from '../../identity/pages/CustomerVerifications.jsx'
import NotificationCenter from '../../notifications/pages/NotificationCenter.jsx'
import NotificationBell from '../../notifications/components/NotificationBell.jsx'
import { useNotificationCount } from '../../notifications/hooks/useNotificationCount.js'
import RentalDecisionDialog from '../../rentals/components/RentalDecisionDialog.jsx'

import { sections, descriptions } from '../utils/adminPresentation.js'
import WorkspaceAccountMenu from '../../../components/account/WorkspaceAccountMenu.jsx'

export default function AdminPage({ user, token, onLogout, onAccountUpdate }) {
  const {
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
  } = useAdminWorkspace({ user, token })
  const unread = useNotificationCount(api)
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/" aria-label="RentEase admin home">
          <BrandMark className="admin-brand-mark" />
          <span>
            RentEase <small>ADMIN</small>
          </span>
        </a>
        <div className="admin-side-label">WORKSPACE</div>
        <WorkspaceNav
          onLogout={onLogout}
          className="admin-nav"
          label="Admin sections"
          active={section}
          items={sections.map(([id, label]) => ({
            id,
            label,
            badge: id === 'shops' ? overview.pendingShops : id === 'requests' ? pendingRequests : id === 'notifications' ? unread : 0,
          }))}
          onSelect={(id) => {
            setSection(id)
            setMessage('')
            setError('')
            if (id === 'requests') refreshRequests()
          }}
        />
        <div className="admin-side-footer">
          <div className="admin-user-avatar">{user.username?.[0]?.toUpperCase() || 'A'}</div>
          <span>
            <b>{user.username}</b>
            <small>Administrator</small>
          </span>
          <button type="button" onClick={onLogout} aria-label="Sign out">
            <UiIcon name="logout" size={17} />
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-actions">
            <NotificationBell api={api} unreadCount={unread} onHistory={() => setSection('notifications')} onNavigate={(target) => setSection(target === 'verification' ? 'identity' : 'requests')} />
            <button
              type="button"
              className="admin-refresh"
              onClick={() => setReload((value) => value + 1)}
            >
              <UiIcon name="refresh" size={16} />
              <span>Refresh</span>
            </button>
            <WorkspaceAccountMenu user={user} api={api} onLogout={onLogout} onAccountUpdate={onAccountUpdate} />
          </div>
        </header>
        <div className="admin-content">
          <div className="admin-page-heading">
            <div>
              <h1>
                {section === 'overview'
                  ? `Welcome back, ${user.username}.`
                  : sections.find(([id]) => id === section)?.[1]}
              </h1>
              <p>
                {section === 'overview'
                  ? 'Here is what is happening on RentEase today.'
                  : descriptions[section]}
              </p>
            </div>
            {section === 'overview' && (
              <button
                type="button"
                className="admin-primary"
                onClick={() => setSection('products')}
              >
                + Add rental listing
              </button>
            )}
            {section === 'products' && (
              <button type="button" className="admin-primary" onClick={openAddItem}>
                + Add item
              </button>
            )}
          </div>
          {error && (
            <div className="admin-alert is-error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="admin-alert" role="status">
              {message}
            </div>
          )}
          {section === 'requests' && requestsError && (
            <div className="admin-alert is-error" role="alert">
              {requestsError}
              <button type="button" onClick={() => setReload((value) => value + 1)}>
                Retry requests
              </button>
            </div>
          )}
          {['requests', 'locations', 'handovers'].includes(section) && (
            <DeliveryTaskBoard api={api} role="admin" />
          )}
          {section === 'locations' && (
            <>
              <DeliveryPricing api={api} />
              <ShopLocation api={api} />
              <DeliveryWorkspace api={api} role="admin" />
            </>
          )}
          {section === 'handovers' && <RentalHandover token={token} refreshKey={reload} />}

          {section === 'packages' && (
            <PackagesPanel
              api={api}
              busy={busy}
              packages={packages}
              products={products}
              runAction={runAction}
              submitPackage={submitPackage}
            />
          )}

          {section === 'overview' && (
            <OverviewPanel
              overview={overview}
              pendingRequests={pendingRequests}
              products={products}
              setSection={setSection}
            />
          )}

          {section === 'products' && (
            <ProductsPanel
              busy={busy}
              deleteProduct={deleteProduct}
              exportCsv={exportCsv}
              holdProduct={holdProduct}
              productSearch={productSearch}
              productStatus={productStatus}
              products={products}
              setEditingProduct={setEditingProduct}
              setProductSearch={setProductSearch}
              setProductStatus={setProductStatus}
              visibleProducts={visibleProducts}
            />
          )}

          {section === 'requests' && (
            <RentalRequestsPanel
              api={api}
              busy={busy}
              rentalRequests={rentalRequests}
              requestsLoading={requestsLoading}
              setDecisionTarget={setDecisionTarget}
            />
          )}

          {section === 'users' && (
            <UsersPanel
              busy={busy}
              deleteUser={deleteUser}
              exportCsv={exportCsv}
              setUserRole={setUserRole}
              setUserSearch={setUserSearch}
              setUserStatus={setUserStatus}
              submitUser={submitUser}
              updateUser={updateUser}
              user={user}
              userRole={userRole}
              userSearch={userSearch}
              userStatus={userStatus}
              users={users}
              visibleUsers={visibleUsers}
            />
          )}

          {section === 'shops' && (
            <ShopApprovalsPanel busy={busy} reviewShop={reviewShop} shops={shops} />
          )}

          {section === 'reports' && (
            <ReportsPanel
              api={api}
              exportCsv={exportCsv}
              overview={overview}
              products={products}
              revenue={revenue}
              users={users}
            />
          )}

          {section === 'coupons' && (
            <PromotionsPanel
              api={api}
              busy={busy}
              coupons={coupons}
              runAction={runAction}
              submitCoupon={submitCoupon}
            />
          )}

          {section === 'identity' && <CustomerVerifications token={token} />}
          {section === 'notifications' && (
            <NotificationCenter
              api={api}
              onNavigate={(target) =>
                setSection(target === 'verification' ? 'identity' : 'requests')
              }
            />
          )}

          {section === 'activity' && <ActivityPanel auditEvents={auditEvents} />}
        </div>
      </section>
      {editingProduct && (
        <EditProductDialog
          key={editingProduct._id}
          busy={busy}
          editProduct={editProduct}
          editingProduct={editingProduct}
          setEditingProduct={setEditingProduct}
        />
      )}
      {addItemOpen && (
        <CreateProductDialog
          busy={busy}
          newItemType={newItemType}
          photos={photos}
          setAddItemOpen={setAddItemOpen}
          setNewItemType={setNewItemType}
          setPhotos={setPhotos}
          submitProduct={submitProduct}
          users={users}
        />
      )}
      {passwordPrompt && (
        <AdminPasswordDialog prompt={passwordPrompt} onClose={() => setPasswordPrompt(null)} />
      )}
      {decisionTarget && (
        <RentalDecisionDialog
          target={decisionTarget}
          api={api}
          onClose={() => setDecisionTarget(null)}
          onDecided={async (message) => {
            setDecisionTarget(null)
            setMessage(message)
            setReload((value) => value + 1)
          }}
        />
      )}
    </main>
  )
}
