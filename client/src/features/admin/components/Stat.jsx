import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export function Stat({ label, value, detail, mark }) {
  return (
    <article className="admin-stat">
      <span className="admin-stat-mark">
        <UiIcon
          name={mark === 'U' ? 'users' : mark === 'P' ? 'box' : mark === 'S' ? 'store' : 'wallet'}
        />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  )
}
