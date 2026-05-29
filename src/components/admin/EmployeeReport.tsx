import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Users, Award, TrendingUp, Calendar, CalendarDays } from 'lucide-react'
import { groupSales } from '@/lib/salesHelper'

interface EmployeePerf {
  id: string
  name: string
  email: string | null
  role: string | null
  totalAmount: number
  salesCount: number
  shareOfSales: number // percentage of total store sales
}

export function EmployeeReport() {
  const [filterType, setFilterType] = useState<'day' | 'month'>('month')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<EmployeePerf[]>([])
  const [totalPeriodSales, setTotalPeriodSales] = useState(0)

  const supabase = createClient()

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0
    }).format(value)
  }

  // Get initials for Avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  // Fetch employee performance data
  useEffect(() => {
    async function fetchPerformance() {
      setLoading(true)
      try {
        // Calculate date boundaries
        let start = new Date()
        let end = new Date()

        if (filterType === 'day') {
          const [year, month, day] = selectedDate.split('-').map(Number)
          start = new Date(year, month - 1, day, 0, 0, 0, 0)
          end = new Date(year, month - 1, day, 23, 59, 59, 999)
        } else {
          // Current calendar month
          const now = new Date()
          start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        }

        // 1. Fetch all profiles in the store
        const { data: profiles, error: pError } = await supabase
          .from('profiles')
          .select('id, name, email, role')
          .order('name', { ascending: true })

        if (pError) throw pError

        // 2. Fetch sales in that range
        const { data: sales, error: sError } = await supabase
          .from('sales')
          .select('id, employee_id, total_amount, description, payment_method, created_at')
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())

        if (sError) throw sError

        // Group combined payments
        const groupedSales = groupSales(sales as any)

        // 3. Aggregate sales by employee in memory
        const salesByEmp: Record<string, { total: number; count: number }> = {}
        let periodTotal = 0

        groupedSales.forEach((sale) => {
          const empId = sale.employee_id
          const amount = sale.total_amount
          periodTotal += amount

          if (!salesByEmp[empId]) {
            salesByEmp[empId] = { total: 0, count: 0 }
          }
          salesByEmp[empId].total += amount
          salesByEmp[empId].count += 1
        })

        setTotalPeriodSales(periodTotal)

        // 4. Map profiles to performance data
        const mappedPerf: EmployeePerf[] = (profiles || [])
          // Only show employees or admins that have registered sales (or are of role employee)
          .filter((p) => p.role === 'employee' || salesByEmp[p.id]?.count > 0)
          .map((p) => {
            const stats = salesByEmp[p.id] || { total: 0, count: 0 }
            const share = periodTotal > 0 ? (stats.total / periodTotal) * 100 : 0
            return {
              id: p.id,
              name: p.name || p.email?.split('@')[0] || 'Sin nombre',
              email: p.email,
              role: p.role,
              totalAmount: stats.total,
              salesCount: stats.count,
              shareOfSales: Math.round(share * 10) / 10
            }
          })
          // Sort by sales amount descending
          .sort((a, b) => b.totalAmount - a.totalAmount)

        setEmployees(mappedPerf)
      } catch (err) {
        console.error('Error fetching employee performance:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchPerformance()
  }, [filterType, selectedDate, supabase])

  return (
    <div className="space-y-6">
      {/* Header and Filter Card */}
      <Card className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl">
        <CardContent className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <Award className="h-5 w-5 text-indigo-500" />
              Rendimiento Comercial
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Analiza la facturación y volumen de ventas de cada miembro de tu equipo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Filter Toggle */}
            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
              <button
                onClick={() => setFilterType('month')}
                className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${filterType === 'month'
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
                  }`}
              >
                Mensual
              </button>
              <button
                onClick={() => setFilterType('day')}
                className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${filterType === 'day'
                    ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50'
                    : 'text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200'
                  }`}
              >
                Día Específico
              </button>
            </div>

            {/* Date Input for Day Specific */}
            {filterType === 'day' && (
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-zinc-400" />
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-8 py-1 px-2.5 bg-zinc-50/50 border-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-950/30 dark:border-zinc-850 rounded-lg text-xs w-36"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading Skeletons */}
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/50 dark:bg-zinc-900 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-2.5 w-full rounded-full" />
            </Card>
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="py-16 text-center border border-zinc-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-xl">
          <Users className="mx-auto h-10 w-10 text-zinc-400 mb-3" />
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            No se registra actividad en este período
          </p>
          <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto">
            {filterType === 'day'
              ? (() => {
                  const [year, month, day] = selectedDate.split('-').map(Number)
                  const d = new Date(year, month - 1, day)
                  return `Ninguna empleada ha realizado ventas el día ${d.toLocaleDateString('es-CL')}.`
                })()
              : 'Ninguna empleada ha realizado ventas este mes.'}
          </p>
        </div>
      ) : (
        /* Performance Grid */
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp, index) => {
            const isTopSeller = index === 0 && emp.totalAmount > 0
            return (
              <Card
                key={emp.id}
                className={`relative overflow-hidden border bg-white shadow-xs dark:bg-zinc-900 rounded-xl transition-all duration-300 hover:shadow-md ${isTopSeller
                    ? 'border-indigo-200 dark:border-indigo-950 ring-1 ring-indigo-50 dark:ring-indigo-950/20'
                    : 'border-zinc-200/80 dark:border-zinc-800/50'
                  }`}
              >
                {/* Visual badge for Top Seller */}
                {isTopSeller && (
                  <div className="absolute top-0 right-0 bg-indigo-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl tracking-wider uppercase">
                    Top Ventas
                  </div>
                )}

                <CardContent className="p-6 space-y-4">
                  {/* Employee Header */}
                  <div className="flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-full font-bold text-sm border shadow-xs ${isTopSeller
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900/30'
                        : 'bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                      }`}>
                      {getInitials(emp.name)}
                    </div>
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-50 truncate">
                        {emp.name}
                      </h4>
                      <p className="text-xs text-zinc-400 truncate">
                        {emp.email || 'Invitado sin correo'}
                      </p>
                    </div>
                  </div>

                  {/* Performance Metrics */}
                  <div className="space-y-1.5 pt-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs text-zinc-450">Monto Facturado:</span>
                      <span className="text-xl font-extrabold text-zinc-900 dark:text-zinc-50">
                        {formatCurrency(emp.totalAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-zinc-500">
                      <span>Transacciones:</span>
                      <span className="font-semibold text-zinc-850 dark:text-zinc-150">
                        {emp.salesCount} {emp.salesCount === 1 ? 'venta' : 'ventas'}
                      </span>
                    </div>
                  </div>

                  {/* Share Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Participación de tienda:</span>
                      <span className="font-semibold">{emp.shareOfSales}%</span>
                    </div>
                    <div className="w-full bg-zinc-100 dark:bg-zinc-850 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isTopSeller ? 'bg-indigo-500' : 'bg-zinc-400 dark:bg-zinc-650'
                          }`}
                        style={{ width: `${emp.shareOfSales}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
