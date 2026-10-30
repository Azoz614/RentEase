import { roleLabels } from '../utils/adminPresentation.js'
import { Empty } from './Empty.jsx'

const roleNames = { user: 'a customer', delivery_partner: 'a delivery partner', rental_shop: 'a rental shop' }

export default function UsersPanel({
  busy,
  deleteUser,
  exportCsv,
  setUserRole,
  setUserSearch,
  setUserStatus,
  submitUser,
  updateUser,
  user,
  userRole,
  userSearch,
  userStatus,
  users,
  visibleUsers,
}) {
  // Each change is confirmed in the admin password dialog, which shows the summary passed here.
  return (
    <div className="admin-work-grid">
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">CREATE ACCOUNT</span>
            <h2>Add a platform user</h2>
          </div>
        </div>
        <form className="admin-form" onSubmit={submitUser}>
          <label>
            Full name
            <input name="username" required placeholder="Name" />
          </label>
          <label>
            Email
            <input name="email" type="email" required placeholder="person@example.com" />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" required placeholder="Phone number" />
          </label>
          <label>
            Temporary password
            <input
              name="password"
              type="password"
              minLength="10"
              required
              placeholder="At least 10 characters"
            />
          </label>
          <label>
            Account type
            <select name="role" defaultValue="user">
              <option value="user">Customer</option>
              <option value="delivery_partner">Delivery partner</option>
              <option value="rental_shop">Rental shop owner</option>
            </select>
          </label>
          <label>
            Shop name <small>Optional for other account types</small>
            <input name="shopName" placeholder="Rental shop name" />
          </label>
          <button className="admin-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'} <span>↗</span>
          </button>
          <p className="admin-form-hint">
            Rental shop accounts created by an admin are approved immediately.
          </p>
        </form>
      </section>
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">DIRECTORY</span>
            <h2>Manage accounts</h2>
          </div>
          <div className="admin-heading-actions">
            <button
              type="button"
              className="admin-text-button"
              onClick={() =>
                exportCsv('rentease-users.csv', [
                  ['Name', 'Email', 'Phone', 'Role', 'Status'],
                  ...users.map((item) => [
                    item.username,
                    item.email,
                    item.phone,
                    roleLabels[item.role] || item.role,
                    item.active ? 'Active' : 'On hold',
                  ]),
                ])
              }
            >
              Export CSV
            </button>
            <span className="admin-count">
              {visibleUsers.length} of {users.length}
            </span>
          </div>
        </div>
        <div className="admin-toolbar">
          <input
            aria-label="Search users"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search name, email, phone…"
          />
          <select
            aria-label="Filter users by role"
            value={userRole}
            onChange={(event) => setUserRole(event.target.value)}
          >
            <option value="all">All roles</option>
            <option value="user">Customers</option>
            <option value="delivery_partner">Delivery partners</option>
            <option value="rental_shop">Rental shops</option>
            <option value="admin">Admins</option>
          </select>
          <select
            aria-label="Filter users by status"
            value={userStatus}
            onChange={(event) => setUserStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">On hold</option>
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((account) => (
                <tr key={account._id}>
                  <td>
                    <b>{account.username}</b>
                    <small>{account.email}</small>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${account.username}`}
                      value={account.role === 'admin' ? 'admin' : account.role}
                      disabled={busy || account.role === 'admin' || account._id === user.id}
                      onChange={(event) =>
                        updateUser(
                          account._id,
                          { role: event.target.value },
                          `Change ${account.username} to ${roleNames[event.target.value]}?`,
                        )
                      }
                    >
                      <option value="user">Customer</option>
                      <option value="delivery_partner">Delivery partner</option>
                      <option value="rental_shop">Rental shop</option>
                      {account.role === 'admin' && <option value="admin">Admin</option>}
                    </select>
                  </td>
                  <td>
                    <span className={`admin-status ${account.active ? 'is-active' : 'is-paused'}`}>
                      {account.active ? 'Active' : 'On hold'}
                    </span>
                  </td>
                  <td>
                    {account.role === 'admin' ? (
                      <small>Protected</small>
                    ) : (
                      <div className="admin-row-actions">
                        <button
                          className="admin-row-action"
                          type="button"
                          disabled={busy || account._id === user.id}
                          onClick={() =>
                            updateUser(
                              account._id,
                              { active: !account.active },
                              account.active
                                ? `Put ${account.username} on hold? They are signed out and their listings hidden.`
                                : `Release ${account.username} from hold?`,
                            )
                          }
                        >
                          {account.active ? 'Hold' : 'Release'}
                        </button>
                        <button
                          className="admin-row-action danger"
                          type="button"
                          disabled={busy || account._id === user.id}
                          onClick={() => deleteUser(account)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleUsers.length && <Empty text="No accounts match those filters." />}
        </div>
      </section>
    </div>
  )
}
