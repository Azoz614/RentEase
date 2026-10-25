import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export function RentalPhoto({ src, alt = '', ...props }) {
  return (
    <>
      <UiIcon name="box" size={36} />
      {src && (
        <img
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
          {...props}
        />
      )}
    </>
  )
}
