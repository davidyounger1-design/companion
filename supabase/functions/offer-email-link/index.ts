import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rule 1 of the linking spec: no cross-tenant search, ever. The caller
// supplies an email and learns NOTHING back — this function returns
// { ok: true } on every path, including "no match", "several matches",
// "email send failed" and "bad input". Any divergence in the response
// body, status code, or timing-visible branching would turn the
// add-participant form into an oracle for "does this person exist
// somewhere else on Companion". Keep every return byte-identical.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const ok = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return ok()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
    const resendKey   = Deno.env.get('RESEND_API_KEY')!
    const appUrl      = Deno.env.get('APP_URL')    ?? 'https://companion.myappbuddy.com.au'
    const fromEmail   = Deno.env.get('FROM_EMAIL') ?? 'Companion <noreply@myappbuddy.com.au>'

    // Verify the calling user's JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: 'companion' },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return ok()

    const { org_id, email, participant_name } = await req.json()
    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!org_id || !trimmedEmail) return ok()

    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'companion' } })

    // The caller must be acting inside their own org.
    const { data: caller } = await admin
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()
    if (caller?.org_id !== org_id) return ok()

    // Cross-org match. The `clients!inner(org_id)` + `.neq` pair is
    // load-bearing: the participant this call is ABOUT has just been
    // created with this same email, so 096's trigger already stamped it
    // onto a brand-new person. A naive `persons.email = X` therefore
    // always finds at least two rows and this function would never send
    // anything. Filtering the embedded clients to other orgs drops the
    // just-created person, whose only enrolment is in org_id.
    const { data: matches, error: matchErr } = await admin
      .from('persons')
      .select('id, full_name, dob, clients!inner(org_id)')
      .eq('email', trimmedEmail)
      .neq('clients.org_id', org_id)
      .limit(2)

    // 0 matches, >1 matches (shared household email), or a read error:
    // send nothing. Ambiguity falls back to the manual code flow, which
    // the account holder can start themselves from their own dashboard.
    if (matchErr || !matches || matches.length !== 1) return ok()

    const { data: org } = await admin
      .from('organisations')
      .select('name')
      .eq('id', org_id)
      .single()

    const orgName  = org?.name ?? 'a Companion plan'
    const partName = (typeof participant_name === 'string' && participant_name.trim())
      || 'a participant'

    // The email body discloses ONLY the new plan's name and the
    // participant's name (spec §7). The minimum-disclosure preview of
    // the OTHER record happens post-sign-in, in the card, server-
    // enforced by email_link_candidate_for.
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [trimmedEmail],
        subject: `${partName} has been added to a plan at ${orgName}`,
        html: buildEmail({ appUrl, orgName, participantName: partName }),
      }),
    })

    return ok()
  } catch {
    return ok()
  }
})

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildEmail({ appUrl, orgName, participantName }: {
  appUrl: string
  orgName: string
  participantName: string
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>A new plan on Companion</title>
</head>
<body style="margin:0;padding:0;background:#f6f2ea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#2f2c26;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2ea;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffefb;border-radius:18px;overflow:hidden;box-shadow:0 2px 16px rgba(47,44,38,0.08);">
        <tr>
          <td style="background:#6f8c78;padding:28px 32px;">
            <p style="margin:0;font-size:22px;font-weight:600;color:#fff;font-family:Georgia,serif;">Companion</p>
            <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">Care journal</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 24px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:400;font-family:Georgia,serif;color:#2f2c26;">A new plan on Companion</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#2f2c26;">
              <strong>${escapeHtml(participantName)}</strong> has been added to a plan at
              <strong>${escapeHtml(orgName)}</strong>, using this email address.
              If you already use Companion, you can link the two records together as the
              same person — sign in and look for the link offer on your journal.
            </p>
            <a href="${appUrl}/"
               style="display:inline-block;background:#6f8c78;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;margin-bottom:24px;">
              Sign in to Companion →
            </a>
            <p style="margin:0;font-size:12px;color:#8a8273;line-height:1.6;">
              Button not working? Copy this link:<br>
              <a href="${appUrl}/" style="color:#4d6655;word-break:break-all;">${appUrl}/</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #ede9e0;">
            <p style="margin:0;font-size:12px;color:#8a8273;line-height:1.5;">
              If this wasn't expected, you can ignore this email — nothing has been linked, and
              nothing will be unless you confirm it while signed in.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
