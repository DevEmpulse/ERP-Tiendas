'use client'

import { useEffect } from 'react'

const SCAN_THRESHOLD_MS = 50
const MIN_BARCODE_LENGTH = 6

interface BarcodeWedgeListenerProps {
  onScan: (barcode: string) => void
}

export function BarcodeWedgeListener({ onScan }: BarcodeWedgeListenerProps) {
  useEffect(() => {
    let buffer = ''
    let lastKeyTime = 0

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if the user is typing into a real input field
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const now = Date.now()

      if (e.key === 'Enter') {
        const elapsed = now - lastKeyTime
        if (buffer.length >= MIN_BARCODE_LENGTH && elapsed <= SCAN_THRESHOLD_MS) {
          onScan(buffer)
        }
        buffer = ''
        return
      }

      if (e.key.length === 1) {
        // If there's a stale buffer (gap too large), reset it
        if (buffer.length > 0 && now - lastKeyTime > SCAN_THRESHOLD_MS) {
          buffer = ''
        }
        buffer += e.key
        lastKeyTime = now
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onScan])

  return null
}
