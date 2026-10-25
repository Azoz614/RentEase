import { BrandMark } from '../components/ui/BrandMark.jsx'
import { RentalArtwork } from '../features/products/components/RentalArtwork.jsx'

import '../features/auth/styles/auth.css'

export default function AuthLayout({ isRegistering, onBrowse, showLogin, showRegister, children }) {
  return (
    <main className={`login-page${isRegistering ? ' is-registering-page' : ''}`}>
      <header className="login-nav">
        <a className="login-brand" href="/" aria-label="RentEase home">
          <BrandMark className="login-brand-mark" />
          <span>
            <b>RentEase</b>
          </span>
        </a>
        <div className="login-nav-signup">
          <a href="/" onClick={onBrowse}>
            Browse listings
          </a>
          <span>{isRegistering ? 'Already have an account?' : 'New to RentEase?'}</span>
          <a
            href={isRegistering ? '/login' : '/register'}
            onClick={isRegistering ? showLogin : showRegister}
          >
            {isRegistering ? 'Sign in' : 'Create an account'}
          </a>
        </div>
      </header>

      <section
        className={`login-layout${isRegistering ? ' is-registering' : ''}`}
        aria-label="RentEase account access"
      >
        <aside className="login-story">
          <div className="login-story-copy">
            <span className="login-story-kicker">TOOLS · GEAR · SPACES</span>
            <h1>
              The right gear.
              <br />
              <em>Right when you need it.</em>
            </h1>
            <p>
              Rent quality equipment and everyday essentials from people and organizations in your
              community.
            </p>
          </div>
          <RentalArtwork />
          <div className="login-story-caption">GOOD GEAR. SHARED WELL.</div>
        </aside>

        {children}
      </section>
    </main>
  )
}
