const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const FROM           = 'Companion <noreply@myappbuddy.com.au>'

function confirmationURL(tokenHash: string, type: string, redirectTo: string): string {
  const url = new URL(`${SUPABASE_URL}/auth/v1/verify`)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

type EmailPayload = {
  user: { email: string; id: string }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

function buildEmail(payload: EmailPayload): { subject: string; html: string } | null {
  const { email_action_type, token_hash, token_hash_new, redirect_to, site_url } = payload.email_data

  // Log payload shape for debugging (token values omitted for security)
  console.log('auth-email-hook type:', email_action_type,
    'has_token_hash:', !!token_hash, 'has_redirect_to:', !!redirect_to, 'site_url:', site_url)

  // Use site_url as base for redirect targets — ensures the app URL is used, not an empty/internal value
  const appBase = site_url || SUPABASE_URL.replace('.supabase.co', '.myappbuddy.com.au')

  // Prefer the explicit redirect_to from the auth request; fall back to app root
  const defaultRedirect = redirect_to || appBase

  // For recovery specifically, send straight to /reset-password so the page
  // handles the recovery session without relying on AuthContext navigation
  const recoveryRedirect = redirect_to?.includes('reset-password')
    ? redirect_to
    : `${appBase}/reset-password`

  const confirmURL = (hash: string, type: string, overrideRedirect?: string) => {
    if (!hash) {
      console.error('auth-email-hook: token_hash is empty for type', type, '— payload:', JSON.stringify(payload.email_data))
      throw new Error(`token_hash missing for ${type}`)
    }
    return confirmationURL(hash, type, overrideRedirect ?? defaultRedirect)
  }

  switch (email_action_type) {
    case 'recovery':
      return {
        subject: 'Reset your password',
        html: `<h2>Reset your password</h2>
<p>We received a request to reset your Companion password.</p>
<p><a href="${confirmURL(token_hash, 'recovery', recoveryRedirect)}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset password</a></p>
<p style="color:#666;font-size:13px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
      }
    case 'signup':
      return {
        subject: 'Confirm your email address',
        html: `<h2>Confirm your email address</h2>
<p>Welcome to Companion! Follow the link below to confirm your email and finish signing up.</p>
<p><a href="${confirmURL(token_hash, 'signup')}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Confirm email address</a></p>`,
      }
    case 'invite':
      return {
        subject: "You've been invited",
        html: `<h2>You've been invited to Companion</h2>
<p>Follow the link below to accept your invitation and set your password.</p>
<p><a href="${confirmURL(token_hash, 'invite')}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Accept invitation</a></p>`,
      }
    case 'magic_link':
      return {
        subject: 'Your sign-in link',
        html: `<h2>Your sign-in link</h2>
<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>
<p><a href="${confirmURL(token_hash, 'magiclink')}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Sign in</a></p>`,
      }
    case 'email_change':
      return {
        subject: 'Confirm your new email address',
        html: `<h2>Confirm your new email address</h2>
<p>Follow the link below to confirm your new email address.</p>
<p><a href="${confirmURL(token_hash_new ?? token_hash, 'email_change')}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Confirm new email</a></p>
<p style="color:#666;font-size:13px">If you didn't request this change, you can safely ignore this email.</p>`,
      }
    default:
      return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })
  }

  let payload: EmailPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  let email: { subject: string; html: string } | null
  try {
    email = buildEmail(payload)
  } catch (buildErr) {
    console.error('auth-email-hook buildEmail error:', buildErr)
    return new Response(JSON.stringify({ error: String(buildErr) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  if (!email) {
    // Unknown type — return success so auth isn't blocked
    return new Response(JSON.stringify({ message: 'unhandled type' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [payload.user.email], subject: email.subject, html: email.html }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: 'email send failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ message: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
