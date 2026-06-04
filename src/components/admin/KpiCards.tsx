import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, ShoppingBag, TrendingUp } from 'lucide-react'

interface KpiCardsProps {
  loading: boolean
  dailyIncome: number
  dailySalesCount: number
  previousIncome?: number // Optional: for showing growth/trend compared to yesterday or average
  highlightedSaleIds?: string[]
  showAmounts?: boolean
}

export function KpiCards({ 
  loading, 
  dailyIncome, 
  dailySalesCount, 
  previousIncome = 0,
  highlightedSaleIds = [],
  showAmounts = true
}: KpiCardsProps) {
  const [isIncomeFlashing, setIsIncomeFlashing] = useState(false)
  const [isCountFlashing, setIsCountFlashing] = useState(false)
  const [prevIncome, setPrevIncome] = useState(dailyIncome)
  const [prevCount, setPrevCount] = useState(dailySalesCount)

  // Trigger flash effect when income increases
  useEffect(() => {
    if (dailyIncome > prevIncome) {
      setIsIncomeFlashing(true)
      const timer = setTimeout(() => setIsIncomeFlashing(false), 2000)
      setPrevIncome(dailyIncome)
      return () => clearTimeout(timer)
    }
    setPrevIncome(dailyIncome)
  }, [dailyIncome, prevIncome])

  // Trigger flash effect when sales count increases
  useEffect(() => {
    if (dailySalesCount > prevCount) {
      setIsCountFlashing(true)
      const timer = setTimeout(() => setIsCountFlashing(false), 2000)
      setPrevCount(dailySalesCount)
      return () => clearTimeout(timer)
    }
    setPrevCount(dailySalesCount)
  }, [dailySalesCount, prevCount])

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(value)
  }

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        {/* Daily Income Skeleton */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-28" />
          </CardContent>
        </Card>

        {/* Daily Sales Count Skeleton */}
        <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-4 w-28" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Daily Income KPI (Primary Card) */}
      <Card className={`relative overflow-hidden border bg-white shadow-xs dark:bg-zinc-900 rounded-xl transition-all duration-500 hover:shadow-md ${
        isIncomeFlashing
          ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.25)] bg-emerald-55/20 dark:bg-emerald-950/15'
          : 'border-zinc-200/80 dark:border-zinc-800/50'
      }`}>
        {/* Glow effect */}
        <div className={`absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 rounded-full blur-2xl transition-all duration-500 ${
          isIncomeFlashing 
            ? 'bg-emerald-500/30 scale-125 dark:bg-emerald-500/25' 
            : 'bg-emerald-500/10 dark:bg-emerald-500/5'
        }`} />
        
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <div>
            <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Ingresos del Día
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Ventas acumuladas hoy
            </CardDescription>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-500 ${
            isIncomeFlashing
              ? 'bg-emerald-500 text-white dark:bg-emerald-500 dark:text-zinc-955'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400'
          }`}>
            <DollarSign className="h-5 w-5" />
          </div>
        </CardHeader>
        
        <CardContent className="pt-2">
          <div className="flex items-baseline space-x-2">
            <span className={`text-4xl font-bold tracking-tight font-sans transition-colors duration-500 ${
              isIncomeFlashing ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-50'
            }`}>
              {showAmounts ? formatCurrency(dailyIncome) : '••••'}
            </span>
            <span className="flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/20">
              <TrendingUp className="mr-1 h-3.5 w-3.5" />
              Hoy
            </span>
          </div>
          
          <div className="mt-3 flex items-center text-xs text-zinc-400">
            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
              isIncomeFlashing ? 'bg-emerald-600 animate-ping' : 'bg-emerald-500 animate-pulse'
            }`} />
            {isIncomeFlashing ? '¡Nueva venta recibida!' : 'Actualizado en tiempo real'}
          </div>
        </CardContent>
      </Card>

      {/* Daily Sales Count KPI */}
      <Card className={`relative overflow-hidden border bg-white shadow-xs dark:bg-zinc-900 rounded-xl transition-all duration-500 hover:shadow-md ${
        isCountFlashing
          ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.25)] bg-blue-55/20 dark:bg-blue-950/15'
          : 'border-zinc-200/80 dark:border-zinc-800/50'
      }`}>
        <div className={`absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 rounded-full blur-2xl transition-all duration-500 ${
          isCountFlashing 
            ? 'bg-blue-500/30 scale-125 dark:bg-blue-500/25' 
            : 'bg-blue-500/10 dark:bg-blue-500/5'
        }`} />
        
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <div>
            <CardTitle className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Ventas Totales
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Transacciones procesadas hoy
            </CardDescription>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-500 ${
            isCountFlashing
              ? 'bg-blue-500 text-white dark:bg-blue-500 dark:text-zinc-955'
              : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 text-blue-600 dark:text-blue-400'
          }`}>
            <ShoppingBag className="h-5 w-5" />
          </div>
        </CardHeader>
        
        <CardContent className="pt-2">
          <div className="flex items-baseline space-x-2">
            <span className={`text-4xl font-bold tracking-tight font-sans transition-colors duration-500 ${
              isCountFlashing ? 'text-blue-650 dark:text-blue-400' : 'text-zinc-900 dark:text-zinc-50'
            }`}>
              {dailySalesCount}
            </span>
            <span className="text-sm text-zinc-400 font-medium">
              órdenes
            </span>
          </div>
          
          <div className="mt-3 text-xs text-zinc-400">
            Promedio por venta: <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {showAmounts ? (dailySalesCount > 0 ? formatCurrency(Math.round(dailyIncome / dailySalesCount)) : formatCurrency(0)) : '••••'}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
