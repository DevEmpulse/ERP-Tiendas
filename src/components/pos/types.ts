export interface CartLine {
  lineId: string           // crypto.randomUUID() — local only, never persisted
  productId: string | null // null = unlisted product
  productName: string
  barcode: string | null
  quantity: number
  unitPrice: number
  subtotal: number         // quantity * unitPrice, recomputed on change
  isUnlisted: boolean
}

export interface PosProduct {
  id: string
  name: string
  barcode: string | null
  salePrice: number
}

export interface StockWarningItem {
  productId: string
  productName: string
  requested: number
  available: number
}

export interface PriceRule {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  special_price: number
  unit_price: number
}
