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
import RentalDecisionDialog from '../../rentals/components/RentalDecisionDialog.jsx'

import { sections, descriptions } from '../utils/adminPresentation.js'

export default function AdminPage({ user, token, onLogout }) {
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
  } = useAdminWorkspace({ user, token })
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
            badge: id === 'shops' ? overview.pendingShops : id === 'requests' ? pendingRequests : 0,
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
          <div>
            <span>RentEase /</span> {sections.find(([id]) => id === section)?.[1]}
          </div>
          <div className="admin-topbar-actions">
            <span className="admin-location">
              <UiIcon name="shield" size={14} /> Admin workspace
            </span>
            <button
              type="button"
              className="admin-refresh"
              onClick={() => setReload((value) => value + 1)}
            >
              <UiIcon name="refresh" size={16} />
              <span>Refresh</span>
            </button>
          </div>
        </header>
        <div className="admin-content">
          <div className="admin-page-heading">
            <div>
              <span className="admin-kicker">CONTROL CENTER</span>
              <h1>
                {section === 'overview'
                  ? `Welcome back, ${user.username}.`
                  : sections.find(([id]) => id === section)?.[1]}
              </h1>
              <p>
                {section === 'overview'
                  ? 'Manage listings, accounts, and rental shop applications.'
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
            <OverviewPanel overview={overview} products={products} setSection={setSection} />
          )}

          {section === 'products' && (
            <ProductsPanel
              api={api}
              exportCsv={exportCsv}
              productSearch={productSearch}
              productStatus={productStatus}
              products={products}
              runAction={runAction}
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
              runAction={runAction}
              setDeclineTarget={setDeclineTarget}
            />
          )}

          {section === 'users' && (
            <UsersPanel
              busy={busy}
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
          busy={busy}
          editProduct={editProduct}
          editingProduct={editingProduct}
          setEditingProduct={setEditingProduct}
        />
      )}
      {addItemOpen && (
        <CreateProductDialog
          busy={busy}
          handlePhotos={handlePhotos}
          newItemType={newItemType}
          photos={photos}
          setAddItemOpen={setAddItemOpen}
          setNewItemType={setNewItemType}
          setPhotos={setPhotos}
          submitProduct={submitProduct}
          users={users}
        />
      )}
      {declineTarget && (
        <RentalDecisionDialog
          target={declineTarget}
          api={api}
          onClose={() => setDeclineTarget(null)}
          onDecided={async (message) => {
            setDeclineTarget(null)
            setMessage(message)
            setReload((value) => value + 1)
          }}
        />
      )}
    </main>
  )
}
