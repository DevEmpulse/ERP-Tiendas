import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { GroupedSale, parseSaleDescription } from './salesHelper'

// Chilean Currency Formatter (e.g., $15.500)
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(value)
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
  let totalSalesCount = sales.length
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
    const items = parseSaleDescription(sale.description, sale.total_amount)
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
