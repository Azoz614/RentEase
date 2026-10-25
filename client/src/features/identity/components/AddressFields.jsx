export function AddressFields({ value, onChange, disabled = false }) {
  return (
    <div className="iv-field-grid">
      {[
        ['line1', 'Address line 1', true],
        ['line2', 'Address line 2 (optional)', false],
        ['city', 'City', true],
        ['district', 'District', true],
        ['province', 'Province', true],
        ['postalCode', 'Postal code (if applicable)', false],
      ].map(([key, label, required]) => (
        <label key={key} className={key.startsWith('line') ? 'iv-span-two' : ''}>
          {label}
          <input
            required={required}
            disabled={disabled}
            value={value[key] || ''}
            maxLength={key.startsWith('line') ? 150 : 80}
            pattern={key === 'postalCode' ? '[0-9]{5}' : undefined}
            autoComplete={
              {
                line1: 'address-line1',
                line2: 'address-line2',
                city: 'address-level2',
                province: 'address-level1',
                postalCode: 'postal-code',
              }[key]
            }
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
      <label>
        Country
        <input value="Sri Lanka" readOnly autoComplete="country-name" />
      </label>
    </div>
  )
}
