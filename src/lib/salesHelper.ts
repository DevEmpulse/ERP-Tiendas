export interface SaleProfile {
  id: string
  name: string | null
  email: string | null
}

export interface SaleItem {
  cant: number
  detalle: string
  p_unit: number
  importe: number
}

export interface Sale {
  id: string
  created_at: string
  description: string
  payment_method: 'cash' | 'transfer' | 'card'
  total_amount: number | string
  employee_id: string
  client_id?: string | null
  clients?: { id: string, phone: string | null } | null
  profiles?: SaleProfile | SaleProfile[] | null
}

export function parseSaleDescription(description: string, fallbackAmount: number | string): SaleItem[] {
  if (!description) {
    const amount = Number(fallbackAmount) || 0
    return [{ cant: 1, detalle: '', p_unit: amount, importe: amount }]
  }

  // 1. Clean description to remove the payment method/reference suffix
  const clean = description
    .replace(/\s*\([^)]*Ref:\s*#[A-Za-z0-9\-]+\)/gi, '')
    .replace(/\s*\((cash|efectivo|transfer|transferencia|card|tarjeta)[^)]*\)/gi, '')
    .trim()

  // 2. Check if clean description is JSON array
  if (clean.startsWith('[') && clean.endsWith(']')) {
    try {
      const parsed = JSON.parse(clean)
      if (Array.isArray(parsed)) {
        return parsed.map((item: Record<string, unknown>) => {
          const cant = Number(item.cant ?? 1)
          const p_unit = Number(item.p_unit ?? 0)
          return {
            cant,
            detalle: String(item.detalle ?? ''),
            p_unit,
            importe: Number(item.importe ?? (cant * p_unit))
          }
        })
      }
    } catch {
      // ignore JSON parse error, fallback to legacy text
    }
  }

  // Fallback for legacy text descriptions
  const amount = Number(fallbackAmount) || 0
  return [
    {
      cant: 1,
      detalle: clean || description,
      p_unit: amount,
      importe: amount
    }
  ]
}


export interface PaymentBreakdown {
  id: string
  method: 'cash' | 'transfer' | 'card'
  amount: number
}

export interface GroupedSale {
  id: string
  created_at: string
  description: string
  employee_id: string
  profiles?: SaleProfile | null
  payments: PaymentBreakdown[]
  total_amount: number
  is_combined: boolean
  ref_code?: string
  client_id?: string | null
  client_phone?: string | null
}

/**
 * Groups sales records that belong to combined payments.
 * Groups by reference code extracted from description (e.g. "Ref: #45KI")
 * or by employee + base description + time minute (fallback).
 */
export function groupSales(sales: Sale[]): GroupedSale[] {
  const grouped: GroupedSale[] = []
  
  // Maps reference code -> index in grouped array
  const refMap = new Map<string, number>()
  
  // Fallback map: (cleanDesc_employeeId_timeMinute) -> index in grouped array
  const fallbackMap = new Map<string, number>()

  sales.forEach((sale) => {
    const amount = Number(sale.total_amount)
    
    // 1. Try to extract reference code (e.g. "Ref: #45KI")
    const refMatch = sale.description.match(/Ref:\s*#([A-Za-z0-9\-]+)/i)
    const refCode = refMatch ? refMatch[1] : null

    // 2. Clean description to remove the payment method/reference suffix
    // E.g. "Campera Boxer Pelota de futbol (Efectivo - Ref: #45KI)" -> "Campera Boxer Pelota de futbol"
    const cleanDesc = sale.description
      .replace(/\s*\([^)]*Ref:\s*#[A-Za-z0-9\-]+\)/gi, '')
      .replace(/\s*\((cash|efectivo|transfer|transferencia|card|tarjeta)[^)]*\)/gi, '')
      .trim()

    if (refCode) {
      if (refMap.has(refCode)) {
        const idx = refMap.get(refCode)!
        const existing = grouped[idx]
        
        // Add payment method breakdown
        existing.payments.push({
          id: sale.id,
          method: sale.payment_method,
          amount: amount
        })
        existing.total_amount += amount
        existing.is_combined = true
        
        // Keep descriptions unified if they are different
        if (cleanDesc && !existing.description.toLowerCase().includes(cleanDesc.toLowerCase())) {
          existing.description = `${existing.description}, ${cleanDesc}`
        }
      } else {
        const newGroup: GroupedSale = {
          id: sale.id,
          created_at: sale.created_at,
          description: cleanDesc || sale.description,
          employee_id: sale.employee_id,
          profiles: (Array.isArray(sale.profiles) ? sale.profiles[0] : sale.profiles) || null,
          payments: [{ id: sale.id, method: sale.payment_method, amount: amount }],
          total_amount: amount,
          is_combined: false,
          ref_code: refCode,
          client_id: sale.client_id || null,
          client_phone: sale.clients?.phone || null
        }
        grouped.push(newGroup)
        refMap.set(refCode, grouped.length - 1)
      }
    } else {
      // Fallback: group by base description, employee, and the exact minute
      const timeMinutes = new Date(sale.created_at).toISOString().substring(0, 16) // YYYY-MM-DDTHH:mm
      const key = `${cleanDesc}_${sale.employee_id}_${timeMinutes}`

      if (fallbackMap.has(key)) {
        const idx = fallbackMap.get(key)!
        const existing = grouped[idx]
        
        existing.payments.push({
          id: sale.id,
          method: sale.payment_method,
          amount: amount
        })
        existing.total_amount += amount
        existing.is_combined = true
      } else {
        const newGroup: GroupedSale = {
          id: sale.id,
          created_at: sale.created_at,
          description: cleanDesc || sale.description,
          employee_id: sale.employee_id,
          profiles: (Array.isArray(sale.profiles) ? sale.profiles[0] : sale.profiles) || null,
          payments: [{ id: sale.id, method: sale.payment_method, amount: amount }],
          total_amount: amount,
          is_combined: false,
          client_id: sale.client_id || null,
          client_phone: sale.clients?.phone || null
        }
        grouped.push(newGroup)
        fallbackMap.set(key, grouped.length - 1)
      }
    }
  })

  return grouped
}
