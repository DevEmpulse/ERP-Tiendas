import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'
import { homeFor, POS_ROLES, STOCK_ROLES } from '@/lib/roles'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const code = request.nextUrl.searchParams.get('code')

  // If there is an auth code in the query params of /login, redirect to /auth/callback immediately
  // without calling updateSession to avoid invalid refresh token errors.
  if (pathname === '/login' && code) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/callback'
    return NextResponse.redirect(redirectUrl)
  }

  // 1. Refresh the session and get the supabase client + user
  const { supabaseResponse, user, supabase } = await updateSession(request)

  // Helper to redirect while keeping the updated session cookies
  const redirectWithCookies = (targetPath: string) => {
    const url = request.nextUrl.clone()
    url.pathname = targetPath
    const redirectResponse = NextResponse.redirect(url)
    
    // Copy the updated session cookies from supabaseResponse to the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, {
        path: cookie.path,
        domain: cookie.domain,
        maxAge: cookie.maxAge,
        expires: cookie.expires,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      })
    })
    return redirectResponse
  }

  const isProtectedRoute = pathname.startsWith('/admin') || pathname.startsWith('/encargado') || pathname.startsWith('/employee') || pathname.startsWith('/superadmin')

  // 2. Handle unauthenticated users
  if (!user) {
    if (isProtectedRoute || pathname === '/') {
      return redirectWithCookies('/login')
    }
    return supabaseResponse
  }

  // 3. Fetch role for authenticated users
  let role: string | null = null
  let hasProfile = false
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile) {
      role = profile.role
      hasProfile = true
    }
  } catch (error) {
    console.error('Error retrieving user role in proxy:', error)
  }

  // If authenticated but has NO profile in our database, they are unauthorized.
  // We must sign them out, clear cookies, and redirect them to /login with an error.
  if (user && !hasProfile) {
    if (pathname === '/login') {
      const response = NextResponse.next()
      request.cookies.getAll().forEach((cookie) => {
        if (cookie.name.startsWith('sb-')) {
          response.cookies.delete(cookie.name)
        }
      })
      return response
    }
    
    const response = redirectWithCookies('/login?error=unauthorized')
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith('sb-')) {
        response.cookies.delete(cookie.name)
      }
    })
    return response
  }

  // 4. Redirect authenticated users away from public auth pages
  if (pathname === '/login') {
    return redirectWithCookies(homeFor(role))
  }

  // 5. Root page redirection
  if (pathname === '/') {
    return redirectWithCookies(homeFor(role))
  }

  // 6. Access control for /superadmin
  if (pathname.startsWith('/superadmin')) {
    if (role !== 'superadmin') {
      return redirectWithCookies('/login')
    }
  }

  // 7. Access control for /admin
  if (pathname.startsWith('/admin')) {
    if (role !== 'admin') {
      return redirectWithCookies(homeFor(role))
    }
  }

  // 8. Access control for /encargado
  if (pathname.startsWith('/encargado')) {
    if (role !== 'encargado') {
      return redirectWithCookies(homeFor(role))
    }
  }

  // 9. Access control for /employee
  if (pathname.startsWith('/employee')) {
    const isEmployeeAllowed = role === 'admin' || (POS_ROLES as readonly string[]).includes(role ?? '') || (STOCK_ROLES as readonly string[]).includes(role ?? '')
    if (!isEmployeeAllowed) {
      return redirectWithCookies(homeFor(role))
    }
  }

  // 10. Access control for /pos
  if (pathname.startsWith('/pos')) {
    const isPosAllowed =
      role === 'admin' ||
      role === 'encargado' ||
      (POS_ROLES as readonly string[]).includes(role ?? '')
    if (!isPosAllowed) {
      return redirectWithCookies(homeFor(role))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - auth (Supabase auth callback and routes)
     * - favicon.ico, sw.js, manifest files (PWA / static public assets)
     * - Files with known static extensions (images, fonts, JS, JSON, ico)
     */
    '/((?!_next/static|_next/image|auth|favicon\\.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|json|woff2?)$).*)',
  ],
}
