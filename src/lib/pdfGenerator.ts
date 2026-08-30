import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { GroupedSale, getSaleLines } from './salesHelper'
import type { ReceiptData } from '@/components/shared/ReceiptModal'
import type {
  ProductRankingRow,
  BranchComparisonRow,
  LowStockRow,
  SalesTrendRow,
  CategoryComparisonRow,
} from './analytics'

// Chilean Currency Formatter (e.g., $15.500)
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(value)
}

// Format a plain 'YYYY-MM-DD' date string (no time component) as DD/MM/YYYY.
// Parsed manually rather than via `new Date(dateStr)` to avoid a
// UTC-midnight-to-local-date off-by-one shift in negative UTC offsets.
const formatDateOnly = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-')
  return year && month && day ? `${day}/${month}/${year}` : dateStr
}

// Format ISO string to readable Date & Time (DD/MM/YYYY HH:MM)
const formatDateTime = (isoString: string) => {
  try {
    const d = new Date(isoString)
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} ${hours}:${hours === '00' && minutes === '00' ? '00' : minutes}`
  } catch {
    return '--/--/----'
  }
}

interface GeneratePdfOptions {
  title: string
  subtitle: string
  sales: GroupedSale[]
  storeName: string
  fileName: string
}

export function generateSalesReportPdf({
  title,
  subtitle,
  sales,
  storeName,
  fileName
}: GeneratePdfOptions) {
  // Create jsPDF instance (A4 size, Portrait, millimeters)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  })

  // 1. Color Palette (Zinc theme matching UI)
  const colors = {
    darkZinc: [24, 24, 27],      // zinc-900 (Text primary)
    mediumZinc: [113, 113, 122],  // zinc-500 (Text secondary)
    lightZinc: [244, 244, 245],   // zinc-100 (Summary background)
    borderZinc: [228, 228, 231],  // zinc-200 (Dividers)
    emerald: [16, 185, 129],      // emerald-500
    white: [255, 255, 255]
  }

  // Page Width
  const pageWidth = doc.internal.pageSize.getWidth()

  // 2. HEADER SECTION
  // Store Name (Top left)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text(storeName.toUpperCase(), 14, 15)

  // Document Title (Below Store Name)
  doc.setFontSize(22)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(title, 14, 24)

  // Subtitle/Date (Below Title)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text(subtitle, 14, 30)

  // Generation Metadata (Top right)
  const todayStr = new Date().toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
  doc.setFontSize(8)
  doc.text(`Generado: ${todayStr}`, pageWidth - 14, 15, { align: 'right' })

  // Horizontal divider line
  doc.setDrawColor(colors.borderZinc[0], colors.borderZinc[1], colors.borderZinc[2])
  doc.setLineWidth(0.5)
  doc.line(14, 34, pageWidth - 14, 34)

  // 3. STATS / SUMMARY CARD
  // Compute totals
  let totalRevenue = 0
  const totalSalesCount = sales.length
  let cashTotal = 0
  let transferTotal = 0
  let cardTotal = 0

  sales.forEach((sale) => {
    totalRevenue += sale.total_amount
    sale.payments.forEach((p) => {
      if (p.method === 'cash') cashTotal += p.amount
      if (p.method === 'transfer') transferTotal += p.amount
      if (p.method === 'card') cardTotal += p.amount
    })
  })

  // Draw light gray summary container
  const summaryY = 38
  const summaryHeight = 22
  doc.setFillColor(colors.lightZinc[0], colors.lightZinc[1], colors.lightZinc[2])
  doc.roundedRect(14, summaryY, pageWidth - 28, summaryHeight, 3, 3, 'F')

  // Card Columns (4 Columns: Recaudado, Ventas, Desglose 1, Desglose 2)
  const colWidth = (pageWidth - 28) / 4

  // Column 1: Total Revenue
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('TOTAL RECAUDADO', 18, summaryY + 6)
  doc.setFontSize(14)
  doc.setTextColor(16, 185, 129) // Emerald color
  doc.text(formatCurrency(totalRevenue), 18, summaryY + 14)

  // Column 2: Total Orders
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('VENTAS TOTALES', 18 + colWidth, summaryY + 6)
  doc.setFontSize(14)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(`${totalSalesCount} transacciones`, 18 + colWidth, summaryY + 14)

  // Column 3: Cash & Transfer breakdown
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('EFECTIVO Y TRANSF.', 18 + colWidth * 2, summaryY + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(`Efectivo: ${formatCurrency(cashTotal)}`, 18 + colWidth * 2, summaryY + 11)
  doc.text(`Transf.: ${formatCurrency(transferTotal)}`, 18 + colWidth * 2, summaryY + 16)

  // Column 4: Card breakdown
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('TARJETAS', 18 + colWidth * 3, summaryY + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(`Tarjeta: ${formatCurrency(cardTotal)}`, 18 + colWidth * 3, summaryY + 11)

  // 4. TRANSACTIONS TABLE
  const tableBody = sales.map((sale) => {
    // Format Products list (Cantidad | Detalle | P.Unit | Importe)
    const items = getSaleLines(sale)
    const productsFormatted = items
      .map((item) => `${item.cant}x ${item.detalle || 'Venta'} (${formatCurrency(item.p_unit)}) = ${formatCurrency(item.importe)}`)
      .join('\n')

    // Format Payment Method(s)
    let paymentStr = ''
    if (!sale.is_combined) {
      const names: Record<string, string> = {
        cash: 'Efectivo',
        transfer: 'Transferencia',
        card: 'Tarjeta'
      }
      paymentStr = names[sale.payments[0]?.method] || sale.payments[0]?.method || '-'
    } else {
      paymentStr = sale.payments
        .map((p) => {
          const m = p.method === 'cash' ? 'Efe' : p.method === 'transfer' ? 'Transf' : 'Tarj'
          return `${m}: ${formatCurrency(p.amount)}`
        })
        .join('\n')
    }

    return [
      formatDateTime(sale.created_at),
      sale.profiles?.name || 'Pre-cargado / Sin nombre',
      productsFormatted,
      paymentStr,
      formatCurrency(sale.total_amount)
    ]
  })

  autoTable(doc, {
    startY: summaryY + summaryHeight + 6,
    head: [['Fecha/Hora', 'Empleada / Vendedor', 'Detalle de Productos (Cant | Unit | Subtotal)', 'Método de Pago', 'Monto Total']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [39, 39, 42], // zinc-800
      textColor: [255, 255, 255],
      fontSize: 8.5,
      fontStyle: 'bold',
      halign: 'left',
      valign: 'middle'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [24, 24, 27], // zinc-900
      valign: 'top',
      cellPadding: 3
    },
    columnStyles: {
      0: { cellWidth: 26 }, // Date
      1: { cellWidth: 32 }, // Employee
      2: { cellWidth: 70 }, // Products list
      3: { cellWidth: 30 }, // Payment Methods
      4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' } // Total
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250]
    },
    margin: { left: 14, right: 14 }
  })

  // Download the PDF
  doc.save(fileName)
}

// ─── Individual Receipt PDF ───────────────────────────────────────────────────

export function generateReceiptPdf(data: ReceiptData) {
  const PAYMENT_LABELS: Record<string, string> = {
    cash: 'Efectivo',
    transfer: 'Transferencia',
    card: 'Tarjeta',
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // Color palette
  const zinc900: [number, number, number] = [24, 24, 27]
  const zinc500: [number, number, number] = [113, 113, 122]
  const zinc200: [number, number, number] = [228, 228, 231]
  const zinc100: [number, number, number] = [244, 244, 245]
  const emerald: [number, number, number] = [16, 185, 129]
  const white: [number, number, number]   = [255, 255, 255]

  // Parse date/time
  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso)
      const day   = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year  = d.getFullYear()
      const hh    = String(d.getHours()).padStart(2, '0')
      const mm    = String(d.getMinutes()).padStart(2, '0')
      return `${day}/${month}/${year}  ${hh}:${mm}`
    } catch { return '' }
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  // Dark header bar
  doc.setFillColor(...zinc900)
  doc.roundedRect(14, 10, pageWidth - 28, 30, 4, 4, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...white)
  doc.text(data.storeName.toUpperCase(), pageWidth / 2, 21, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(180, 180, 185)
  doc.text('COMPROBANTE DE VENTA', pageWidth / 2, 28, { align: 'center' })
  doc.text(formatDateTime(data.createdAt), pageWidth / 2, 34, { align: 'center' })

  // ── Info grid ───────────────────────────────────────────────────────────────
  const infoY = 48
  doc.setFillColor(...zinc100)
  doc.roundedRect(14, infoY, pageWidth - 28, 22, 3, 3, 'F')

  const col = (pageWidth - 28) / 3
  const infoItems = [
    { label: 'VENDEDOR/A', value: data.employeeName || '—' },
    { label: 'CLIENTE', value: data.clientName || (data.clientPhone ? data.clientPhone : '—') },
    { label: 'TELÉFONO', value: data.clientPhone || '—' },
  ]
  infoItems.forEach((item, i) => {
    const x = 18 + col * i
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...zinc500)
    doc.text(item.label, x, infoY + 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...zinc900)
    doc.text(item.value, x, infoY + 14, { maxWidth: col - 4 })
  })

  // ── Products table ──────────────────────────────────────────────────────────
  const tableBody = data.products.map(p => [
    String(p.cant),
    p.detalle,
    formatCurrency(p.p_unit),
    formatCurrency(p.importe),
  ])

  autoTable(doc, {
    startY: infoY + 28,
    head: [['Cant', 'Descripción', 'P. Unitario', 'Importe']],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: zinc900,
      textColor: white,
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'left',
    },
    bodyStyles: {
      fontSize: 9,
      textColor: zinc900,
      valign: 'top',
      cellPadding: 3,
    },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })

  // ── Total box ──────────────────────────────────────────────────────────────
  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  const totalBoxH = 16
  doc.setFillColor(...emerald)
  doc.roundedRect(14, finalY, pageWidth - 28, totalBoxH, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...white)
  doc.text('TOTAL', 20, finalY + 10)
  doc.setFontSize(14)
  doc.text(formatCurrency(data.totalAmount), pageWidth - 18, finalY + 10, { align: 'right' })

  // ── Payment breakdown ──────────────────────────────────────────────────────
  const payY = finalY + totalBoxH + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...zinc500)
  doc.text('FORMA DE PAGO', 14, payY)

  doc.setDrawColor(...zinc200)
  doc.setLineWidth(0.4)
  doc.line(14, payY + 2, pageWidth - 14, payY + 2)

  data.payments.forEach((p, i) => {
    const y = payY + 8 + i * 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...zinc900)
    const label = PAYMENT_LABELS[p.method] ?? p.method
    doc.text(label, 18, y)
    doc.setFont('helvetica', 'bold')
    doc.text(formatCurrency(p.amount), pageWidth - 18, y, { align: 'right' })
  })

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = doc.internal.pageSize.getHeight() - 16
  doc.setDrawColor(...zinc200)
  doc.setLineWidth(0.3)
  doc.line(14, footerY - 4, pageWidth - 14, footerY - 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...zinc500)
  doc.text('¡Gracias por su compra!', pageWidth / 2, footerY, { align: 'center' })
  const now = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  doc.setFontSize(7)
  doc.text(`Generado: ${now}`, pageWidth / 2, footerY + 6, { align: 'center' })

  // Save
  const safeDate = formatDateTime(data.createdAt).replace(/[/:, ]+/g, '-').trim()
  doc.save(`comprobante-${safeDate}.pdf`)
}

// ─── Analytics Report PDF ──────────────────────────────────────────────────
// Mirrors generateSalesReportPdf's structure (zinc palette, header block,
// 4-column summary card, autoTable per section chained off lastAutoTable.
// finalY). Charts are NOT rasterized here — tables satisfy the spec's
// "reflecting the currently displayed metrics" with no new dependency.

interface GenerateAnalyticsPdfOptions {
  storeName: string
  branchLabel: string
  periodLabel: string
  products: ProductRankingRow[]
  branches: BranchComparisonRow[]
  lowStock: LowStockRow[]
  salesTrend: SalesTrendRow[]
  categories: CategoryComparisonRow[]
  fileName: string
}

export function generateAnalyticsReportPdf({
  storeName,
  branchLabel,
  periodLabel,
  products,
  branches,
  lowStock,
  salesTrend,
  categories,
  fileName,
}: GenerateAnalyticsPdfOptions) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const colors = {
    darkZinc: [24, 24, 27],
    mediumZinc: [113, 113, 122],
    lightZinc: [244, 244, 245],
    borderZinc: [228, 228, 231],
    emerald: [16, 185, 129],
  }

  const pageWidth = doc.internal.pageSize.getWidth()

  // 1. HEADER
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text(storeName.toUpperCase(), 14, 15)

  doc.setFontSize(22)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text('Reporte de Analítica', 14, 24)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text(`${periodLabel} · ${branchLabel}`, 14, 30)

  const todayStr = new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  doc.setFontSize(8)
  doc.text(`Generado: ${todayStr}`, pageWidth - 14, 15, { align: 'right' })

  doc.setDrawColor(colors.borderZinc[0], colors.borderZinc[1], colors.borderZinc[2])
  doc.setLineWidth(0.5)
  doc.line(14, 34, pageWidth - 14, 34)

  // 2. SUMMARY CARD (4 columns: revenue, transactions, margin, low-stock count)
  const totalRevenue = products.reduce((acc, p) => acc + p.revenue, 0)
  const totalTransactions = branches.reduce((acc, b) => acc + b.sales_count, 0)
  const totalMargin = products.reduce((acc, p) => acc + p.margin_estimated, 0)
  const lowStockCount = lowStock.length

  const summaryY = 38
  const summaryHeight = 22
  doc.setFillColor(colors.lightZinc[0], colors.lightZinc[1], colors.lightZinc[2])
  doc.roundedRect(14, summaryY, pageWidth - 28, summaryHeight, 3, 3, 'F')

  const colWidth = (pageWidth - 28) / 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('INGRESOS TOTALES', 18, summaryY + 6)
  doc.setFontSize(13)
  doc.setTextColor(16, 185, 129)
  doc.text(formatCurrency(totalRevenue), 18, summaryY + 14)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('TRANSACCIONES', 18 + colWidth, summaryY + 6)
  doc.setFontSize(13)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(`${totalTransactions}`, 18 + colWidth, summaryY + 14)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('MARGEN ESTIMADO', 18 + colWidth * 2, summaryY + 6)
  doc.setFontSize(13)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text(formatCurrency(totalMargin), 18 + colWidth * 2, summaryY + 14)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(colors.mediumZinc[0], colors.mediumZinc[1], colors.mediumZinc[2])
  doc.text('STOCK BAJO', 18 + colWidth * 3, summaryY + 6)
  doc.setFontSize(13)
  doc.setTextColor(lowStockCount > 0 ? 217 : colors.darkZinc[0], lowStockCount > 0 ? 119 : colors.darkZinc[1], lowStockCount > 0 ? 6 : colors.darkZinc[2])
  doc.text(`${lowStockCount} producto${lowStockCount === 1 ? '' : 's'}`, 18 + colWidth * 3, summaryY + 14)

  let cursorY = summaryY + summaryHeight + 6
  const finalYOf = () => (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // 3. PRODUCT RANKING TABLE
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(colors.darkZinc[0], colors.darkZinc[1], colors.darkZinc[2])
  doc.text('Ranking de Productos', 14, cursorY)
  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Producto', 'Unidades', 'Ingresos', 'Margen Estimado', 'Margen Realizado']],
    body: products.map((p) => [
      p.product_name,
      String(p.units_sold),
      formatCurrency(p.revenue),
      formatCurrency(p.margin_estimated),
      formatCurrency(p.margin_realized),
    ]),
    theme: 'grid',
    headStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [24, 24, 27], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })
  cursorY = finalYOf() + 10

  // 4. BRANCH COMPARISON TABLE
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Comparación de Sucursales', 14, cursorY)
  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Sucursal', 'Ingresos', 'Ventas', 'Stock']],
    body: branches.map((b) => [b.branch_name, formatCurrency(b.revenue), String(b.sales_count), String(b.stock_units)]),
    theme: 'grid',
    headStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [24, 24, 27], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })
  cursorY = finalYOf() + 10

  // 5. LOW STOCK TABLE
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Alertas de Stock Bajo', 14, cursorY)
  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Producto', 'Sucursal', 'Stock Actual', 'Mínimo', 'Déficit']],
    body: lowStock.map((r) => [r.product_name, r.branch_name, String(r.current_stock), String(r.min_stock), String(r.deficit)]),
    theme: 'grid',
    headStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [24, 24, 27], cellPadding: 2.5 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })
  cursorY = finalYOf() + 10

  // 6. SALES TREND TABLE
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Tendencia de Ventas', 14, cursorY)
  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Fecha', 'Ingresos']],
    body: salesTrend.map((r) => [formatDateOnly(r.day), formatCurrency(r.revenue)]),
    theme: 'grid',
    headStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [24, 24, 27], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })
  cursorY = finalYOf() + 10

  // 7. CATEGORY COMPARISON TABLE
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Comparación por Categorías', 14, cursorY)
  autoTable(doc, {
    startY: cursorY + 3,
    head: [['Categoría', 'Unidades', 'Ingresos']],
    body: categories.map((c) => [c.category_name, String(c.units_sold), formatCurrency(c.revenue)]),
    theme: 'grid',
    headStyles: { fillColor: [39, 39, 42], textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [24, 24, 27], cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 14, right: 14 },
  })

  doc.save(fileName)
}
