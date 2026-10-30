import { useEffect, useId, useRef, useState } from 'react'
import { BrandMark } from '../ui/BrandMark.jsx'
import { UiIcon } from '../ui/UiIcon.jsx'
import { footerBusiness, footerGuides } from './footerContent.js'
import './site-footer.css'

export function SocialIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {name === 'instagram' ? <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>
        : name === 'facebook' ? <path d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5L15 1c-3 0-5 2-5 5v3H7v4h3v8" />
          : <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 10v7m4 0v-7m0 3c0-4 6-4 6 0v4" /><circle cx="7" cy="7" r=".8" fill="currentColor" /></>}
    </svg>
  )
}

export function FooterGuide({ topic, onClose }) {
  const dialog = useRef(null)
  const headingId = useId()
  const guide = footerGuides[topic]
  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement
    const previousOverflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  return (
    <dialog ref={dialog} className="site-footer-guide" aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="site-footer-guide-heading">
        <span className="site-footer-eyebrow">RENTEASE / THE RENTAL GUIDE</span>
        <button type="button" onClick={onClose} aria-label="Close rental guide" autoFocus><UiIcon name="close" /></button>
      </div>
      <h2 id={headingId}>{guide.title}</h2>
      <p className="site-footer-guide-intro">{guide.intro}</p>
      {guide.sections.map(([title, text]) => <section key={title}><h3>{title}</h3><p>{text}</p></section>)}
      {topic === 'contact' && <address className="site-footer-guide-contact">
        <b>{footerBusiness.isDemo ? 'Sample contact details' : 'Our contact details'}</b>
        <a href={`mailto:${footerBusiness.email}`}>{footerBusiness.email}</a>
        <span>{footerBusiness.phone}</span><span>{footerBusiness.address}</span><span>{footerBusiness.hours}</span>
      </address>}
      <button className="site-footer-guide-done" type="button" onClick={onClose}>Got it <UiIcon name="check" size={16} /></button>
    </dialog>
  )
}

function FooterLinks({ title, label, children }) {
  const [expanded, setExpanded] = useState(() => window.matchMedia?.('(min-width: 761px)').matches ?? true)
  useEffect(() => {
    const breakpoint = window.matchMedia?.('(min-width: 761px)')
    if (!breakpoint) return
    const update = (event) => setExpanded(event.matches)
    breakpoint.addEventListener('change', update)
    return () => breakpoint.removeEventListener('change', update)
  }, [])
  return (
    <details className="site-footer-links" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{title}<span aria-hidden="true">+</span></summary>
      <nav aria-label={label}>{children}</nav>
    </details>
  )
}

export default function SiteFooter({ authenticated = false, onNavigate, onBrowse, onSignIn, onRegister }) {
  const [topic, setTopic] = useState(null)
  const [year] = useState(() => new Date().getFullYear())
  const footer = useRef(null)
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!window.IntersectionObserver || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setEntered(true)
        observer.disconnect()
      }
    }, { threshold: 0.08 })
    observer.observe(footer.current)
    return () => observer.disconnect()
  }, [])
  const openGuide = (name) => setTopic(name)
  const browse = (event) => { if (onBrowse) { event.preventDefault(); onBrowse() } }
  const accountLink = (view) => (event) => {
    if (authenticated && onNavigate) { event.preventDefault(); onNavigate(view) }
    else if (!authenticated && onSignIn) { event.preventDefault(); onSignIn() }
  }
  const register = (event) => { if (onRegister) { event.preventDefault(); onRegister() } }
  const backToTop = () => {
    window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    document.querySelector('main a, main button')?.focus({ preventScroll: true })
  }
  return (
    <>
      <footer ref={footer} className={`site-footer${authenticated ? ' site-footer--customer' : ''}${entered ? ' is-visible' : ''}`} aria-label="RentEase footer">
        <div className="site-footer-body">
          <div className="site-footer-grid">
            <div className="site-footer-brand-column">
              <a className="site-footer-brand" href="/" onClick={browse} aria-label="RentEase home"><BrandMark /><span>RentEase<span className="site-footer-brand-dot">.</span></span></a>
              <p>Good gear, from shops near you.<br />Rent what you need. Own the moment.</p>
              <div className="site-footer-socials" aria-label={footerBusiness.isDemo ? 'Sample social links' : 'Follow RentEase'}>
                {footerBusiness.socials.map((social) => <a key={social.name} href={social.url} target="_blank" rel="noopener noreferrer" aria-label={`${social.name}${footerBusiness.isDemo ? ' (demo link)' : ''}`}><SocialIcon name={social.icon} /></a>)}
              </div>
            </div>
            <FooterLinks title="Explore" label="Explore RentEase"><a href="/" onClick={browse}>Browse all rentals</a><a href={authenticated ? '/?view=requests' : '/login'} onClick={accountLink('requests')}>My rentals</a><a href={authenticated ? '/?view=wishlist' : '/login'} onClick={accountLink('wishlist')}>Saved favourites</a><button type="button" onClick={() => openGuide('about')}>About RentEase</button></FooterLinks>
            <FooterLinks title="Here to help" label="Rental help"><button type="button" onClick={() => openGuide('how')}>How renting works</button><button type="button" onClick={() => openGuide('delivery')}>Pickup & delivery</button><button type="button" onClick={() => openGuide('returns')}>Returns & cancellations</button><button type="button" onClick={() => openGuide('deposits')}>Prices & deposits</button><button type="button" onClick={() => openGuide('safety')}>Rental safety</button></FooterLinks>
            <FooterLinks title="Grow with us" label="RentEase partners"><button type="button" onClick={() => openGuide('partners')}>List your rental shop</button><button type="button" onClick={() => openGuide('riders')}>Become a delivery partner</button>{!authenticated && <a href="/register" onClick={register}>Create an account <span aria-hidden="true">↗</span></a>}<button type="button" onClick={() => openGuide('contact')}>Contact our team</button></FooterLinks>
            <div className="site-footer-contact"><h3>Let’s talk</h3><a href={`mailto:${footerBusiness.email}`}><UiIcon name="mail" size={17} /><span>{footerBusiness.email}</span></a><a href={`tel:${footerBusiness.telephone}`}><UiIcon name="phone" size={17} /><span>{footerBusiness.phone}</span></a><address><UiIcon name="pin" size={17} /><span>{footerBusiness.address}</span></address><div><UiIcon name="clock" size={17} /><span>{footerBusiness.hours}<small>Sri Lanka time · GMT+5:30</small></span></div>{footerBusiness.isDemo && <small className="site-footer-demo">Sample contact details & social links.</small>}</div>
          </div>
          <div className="site-footer-bottom"><small>© {year} RentEase. All rights reserved.</small><nav aria-label="Footer information"><button type="button" onClick={() => openGuide('privacy')}>Privacy</button><button type="button" onClick={() => openGuide('terms')}>Terms of use</button><span>Sri Lanka <span aria-hidden="true">·</span> LKR</span></nav><button className="site-footer-back" type="button" onClick={backToTop}>Back to top <span aria-hidden="true">↑</span></button></div>
        </div>
      </footer>
      {topic && <FooterGuide key={topic} topic={topic} onClose={() => setTopic(null)} />}
    </>
  )
}
