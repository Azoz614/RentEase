import { BrandMark } from '../components/ui/BrandMark.jsx'
import { UiIcon } from '../components/ui/UiIcon.jsx'
import { RentalArtwork } from '../features/products/components/RentalArtwork.jsx'
import SiteFooter from '../components/layout/SiteFooter.jsx'

import '../features/auth/styles/auth.css'

const highlights = ['Approved local rental shops', 'Pickup or doorstep delivery', 'ID-verified renters']

export default function AuthLayout({ isRegistering, onBrowse, showLogin, showRegister, children }) {
  return (
    <>
    <main className="login-page">
      <header className="login-nav">
        <a className="login-brand" href="/" onClick={onBrowse} aria-label="RentEase home">
          <BrandMark className="login-brand-mark" />
          <b>RentEase</b>
        </a>
        <nav className="login-nav-links" aria-label="Account">
          <a href="/" onClick={onBrowse}>Browse rentals</a>
          <a className="login-nav-cta" href={isRegistering ? '/login' : '/register'}
            onClick={isRegistering ? showLogin : showRegister}>
            {isRegistering ? 'Sign in' : 'Sign up'}
          </a>
        </nav>
      </header>

      <section className="login-layout" aria-label="RentEase account access">
        <aside className="login-story">
          <h1>Rent the gear you need, from shops near you.</h1>
          <RentalArtwork />
          <ul className="login-highlights">
            {highlights.map((item) => (
              <li key={item}><UiIcon name="check" size={16} />{item}</li>
            ))}
          </ul>
        </aside>
        {children}
      </section>
    </main>
    <SiteFooter />
    </>
  )
}
