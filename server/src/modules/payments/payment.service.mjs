import { randomUUID } from 'node:crypto'

export const depositFor = (request) =>
  request.items.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0)

export const adjustmentTotal = (request) =>
  (request.payment?.adjustments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)

export const invoiceNumber = () =>
  `RE-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`

export function invoicePdf(request) {
  const paid = Number(request.payment?.rentalPaid || 0)
  const held = Number(request.payment?.depositHeld || 0)
  const refunded = Number(request.payment?.depositRefunded || 0)
  const lines = [
    'RentEase | Rental invoice',
    `Invoice: ${request.invoiceNumber || 'Pending payment'}`,
    `Booking: ${request._id}`,
    `Status: ${request.status}`,
    `Rental dates: ${new Date(request.startDate).toLocaleDateString('en-CA')} to ${new Date(request.endDate).toLocaleDateString('en-CA')}`,
    ...request.items.map(
      (item) => `${item.title}  LKR ${Number(item.rentalAmount || 0).toLocaleString('en-LK')}`,
    ),
    `Rental + delivery: LKR ${Number(request.total || 0).toLocaleString('en-LK')}`,
    `Deposit held: LKR ${held.toLocaleString('en-LK')}`,
    `Adjustments: LKR ${adjustmentTotal(request).toLocaleString('en-LK')}`,
    `Deposit refunded: LKR ${refunded.toLocaleString('en-LK')}`,
    `Payment received: LKR ${paid.toLocaleString('en-LK')}`,
  ]
  const escape = (value) =>
    String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = [
    'BT',
    '/F1 12 Tf',
    '50 790 Td',
    ...lines
      .flatMap((line, index) => [index ? '0 -22 Td' : '', `(${escape(line)}) Tj`])
      .filter(Boolean),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}
