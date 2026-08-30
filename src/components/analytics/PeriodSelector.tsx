'use client'

import { CalendarRange } from 'lucide-react'

export type PeriodDays = 7 | 30 | 90

interface PeriodSelectorProps {
  value: PeriodDays
  onChange: (days: PeriodDays) => void
  label: string
}

const PRESETS: { days: PeriodDays; label: string }[] = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
]

/** 7d / 30d (default) / 90d rolling-window presets for every analytics panel. */
export function PeriodSelector({ value, onChange, label }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
        {PRESETS.map((preset) => (
          <button
            key={preset.days}
            type="button"
            onClick={() => onChange(preset.days)}
            className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
              value === preset.days
                ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <CalendarRange className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
    </div>
  )
}
