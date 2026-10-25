export const formatCurrency = (amount) => `LKR ${Number(amount || 0).toLocaleString('en-LK')}`

export const formatCurrencyFixed = (amount) =>
  `LKR ${Number(amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
