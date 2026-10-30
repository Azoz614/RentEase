import { useState } from 'react'
import { BrandMark } from '../ui/BrandMark.jsx'
import { UiIcon } from '../ui/UiIcon.jsx'
import { FooterGuide, SocialIcon } from './SiteFooter.jsx'
import { footerBusiness } from './footerContent.js'
import './workspace-footer.css'

// Every guide from the customer footer; shoppers' links (My rentals, favourites) are left out
// because shop and rider accounts have no customer pages.
const guides = [
  ['about', 'About RentEase'],
  ['how', 'How renting works'],
  ['delivery', 'Pickup & delivery'],
  ['returns', 'Returns & cancellations'],
  ['deposits', 'Prices & deposits'],
  ['safety', 'Rental safety'],
  ['partners', 'For rental shops'],
  ['riders', 'For delivery partners'],
  ['contact', 'Contact our team'],
]

// The customer footer's information in a compact strip for the shop owner and rider workspaces.
export default function WorkspaceFooter() {
  const [topic, setTopic] = useState(null)
  const [year] = useState(() => new Date().getFullYear())
  const backToTop = () =>
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  return (
    <>
      <footer className="workspace-footer" aria-label="RentEase footer">
        <div className="workspace-footer-row">
          <span className="workspace-footer-brand">
            <BrandMark />
            <b>RentEase</b>
            <small>Good gear, from shops near you.</small>
          </span>
          <div
            className="workspace-footer-socials"
            aria-label={footerBusiness.isDemo ? 'Sample social links' : 'Follow RentEase'}
          >
            {footerBusiness.socials.map((social) => (
              <a
                key={social.name}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${social.name}${footerBusiness.isDemo ? ' (demo link)' : ''}`}
              >
                <SocialIcon name={social.icon} />
              </a>
            ))}
          </div>
        </div>
        <nav className="workspace-footer-guides" aria-label="RentEase help">
          {guides.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTopic(id)}>
              {label}
            </button>
          ))}
        </nav>
        <address className="workspace-footer-contact">
          <a href={`mailto:${footerBusiness.email}`}>
            <UiIcon name="mail" size={14} />
            {footerBusiness.email}
          </a>
          <a href={`tel:${footerBusiness.telephone}`}>
            <UiIcon name="phone" size={14} />
            {footerBusiness.phone}
          </a>
          <span>
            <UiIcon name="pin" size={14} />
            {footerBusiness.address}
          </span>
          <span>
            <UiIcon name="clock" size={14} />
            {footerBusiness.hours} (GMT+5:30)
          </span>
          {footerBusiness.isDemo && <small>Sample contact details & social links.</small>}
        </address>
        <div className="workspace-footer-row workspace-footer-bottom">
          <small>© {year} RentEase. All rights reserved.</small>
          <nav aria-label="Footer information">
            <button type="button" onClick={() => setTopic('privacy')}>
              Privacy
            </button>
            <button type="button" onClick={() => setTopic('terms')}>
              Terms of use
            </button>
            <span>Sri Lanka · LKR</span>
            <button type="button" onClick={backToTop}>
              Back to top ↑
            </button>
          </nav>
        </div>
      </footer>
      {topic && <FooterGuide key={topic} topic={topic} onClose={() => setTopic(null)} />}
    </>
  )
}
