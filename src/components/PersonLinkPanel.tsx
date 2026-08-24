import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'

type OtherDrawer = { id: string; orgName: string }
type Preview = { firstName: string; lastInitial: string; dob: string | null; sourceOrgName: string }

/**
 * Lets the participant or their decision-maker link this enrolment to
 * another one of the same person's plans, or unlink it. NEVER shown to a
 * coordinator or worker — the server enforces this independently
 * (companion.is_participant_or_decision_maker), this is just where the
 * UI happens to live, not the security boundary.
 *
 * Rule 4 (identity-access-model-design.md §4.1): always show the
 * confirmation preview (first name, last initial, dob, source org) before
 * committing, even when the person entering the code is confident it's
 * right — "I'm obviously me" is exactly the assumption under which
 * someone pastes the wrong code and confirms without reading.
 */
export default function PersonLinkPanel({ clientId, participantName }: { clientId: string; participantName: string }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'idle' | 'generate' | 'redeem'>('idle')
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')

  const { data: person } = useQuery({
    queryKey: ['participant-person', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('participants').select('person_id').eq('id', clientId).single()
      if (error) throw error
      return data
    },
  })

  // Every OTHER enrolment sharing this person — RLS on `clients` still
  // applies, so this only shows drawers this signed-in person can already
  // see (which, for whoever holds decision-maker/participant status on
  // both sides, is exactly the drawers they linked). It can undercount a
  // cabinet's true drawer count if a third drawer belongs to someone this
  // caller has no visibility into — that's fine, "linked to at least one
  // other plan" is all this needs to know.
  const { data: otherDrawers } = useQuery({
    queryKey: ['linked-drawers', person?.person_id, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, organisations(name)')
        .eq('person_id', person!.person_id)
        .neq('id', clientId)
      if (error) throw error
      return (data ?? []).map((d) => ({
        id: d.id,
        orgName: (d.organisations as unknown as { name: string } | null)?.name ?? 'another plan',
      })) as OtherDrawer[]
    },
    enabled: !!person?.person_id,
  })

  const isLinked = (otherDrawers?.length ?? 0) > 0

  function resetFlow() {
    setMode('idle'); setGeneratedCode(null); setCodeInput(''); setPreview(null); setError('')
  }

  const generateCode = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_person_link_code', { p_client_id: clientId })
      if (error) throw error
      return (data as { code: string; expires_at: string }[])[0]
    },
    onSuccess: (row) => { setGeneratedCode({ code: row.code, expiresAt: row.expires_at }); setError('') },
    onError: (e) => setError(errorMessage(e, 'Could not generate a code. Try again.')),
  })

  const previewLink = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('preview_person_link', {
        p_code: codeInput.trim(), p_target_client_id: clientId,
      })
      if (error) throw error
      const rows = data as { first_name: string; last_initial: string; dob: string | null; source_org_name: string }[]
      if (!rows.length) throw new Error('That code is invalid or has expired.')
      return rows[0]
    },
    onSuccess: (row) => {
      setPreview({ firstName: row.first_name, lastInitial: row.last_initial, dob: row.dob, sourceOrgName: row.source_org_name })
      setError('')
    },
    onError: (e) => { setError(errorMessage(e, 'That code is invalid or has expired.')); setPreview(null) },
  })

  const confirmLink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('confirm_person_link', {
        p_code: codeInput.trim(), p_target_client_id: clientId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      resetFlow()
      qc.invalidateQueries({ queryKey: ['linked-drawers'] })
    },
    onError: (e) => setError(errorMessage(e, 'Could not complete the link. Try again.')),
  })

  const unlink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('unlink_person', { p_client_id: clientId })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['linked-drawers'] }),
    onError: (e) => setError(errorMessage(e, 'Could not unlink. Try again.')),
  })

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
      <button
        onClick={() => setExpanded((x) => !x)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          width: '100%', background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
        }}
      >
        🔗 {isLinked ? 'Linked to another plan' : 'Link to another plan'}
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: '0.875rem' }}>
          {isLinked ? (
            <>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                {participantName}'s record here is linked with the same person's record in:
                {' '}{otherDrawers!.map((d) => d.orgName).join(', ')}. Journal, goals, and photos show
                activity from every linked plan — notices and messages stay separate.
              </p>
              {error && <div className="alert alert-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
              <button className="btn btn-ghost" style={{ fontSize: '0.8rem', color: 'var(--color-error)' }}
                disabled={unlink.isPending} onClick={() => unlink.mutate()}>
                {unlink.isPending ? <span className="spinner" /> : 'Unlink this plan'}
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
                If {participantName} is also enrolled in another Companion plan, link the two records so
                journal entries, goals and photos show up in one place for both.
              </p>

              {mode === 'idle' && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
                    onClick={() => { resetFlow(); setMode('generate'); generateCode.mutate() }}>
                    Generate a code for the other plan
                  </button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
                    onClick={() => { resetFlow(); setMode('redeem') }}>
                    I have a code
                  </button>
                </div>
              )}

              {mode === 'generate' && (
                <div>
                  {generateCode.isPending && <span className="spinner" />}
                  {generatedCode && (
                    <div className="card card-sm" style={{ background: 'var(--color-bg)' }}>
                      <p style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                        Share this code with whoever manages {participantName}'s other plan — they'll
                        enter it there under "I have a code." It expires{' '}
                        {new Date(generatedCode.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                      </p>
                      <p style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.05em',
                        wordBreak: 'break-all', marginBottom: '0.5rem' }}>
                        {generatedCode.code}
                      </p>
                    </div>
                  )}
                  {error && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
                  <button className="btn btn-ghost" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }} onClick={resetFlow}>
                    Done
                  </button>
                </div>
              )}

              {mode === 'redeem' && (
                <div>
                  {!preview ? (
                    <>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <input className="input" style={{ flex: '1 1 200px', fontFamily: 'monospace' }}
                          placeholder="Paste the code" value={codeInput}
                          onChange={(e) => { setCodeInput(e.target.value); setError('') }} />
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                          disabled={!codeInput.trim() || previewLink.isPending}
                          onClick={() => previewLink.mutate()}>
                          {previewLink.isPending ? <span className="spinner" /> : 'Look up'}
                        </button>
                      </div>
                      {error && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
                    </>
                  ) : (
                    <div className="card card-sm" style={{ background: 'var(--color-bg)' }}>
                      <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        This code links to <strong>{preview.firstName} {preview.lastInitial}.</strong>
                        {preview.dob && <>, born {new Date(preview.dob).toLocaleDateString()}</>} at{' '}
                        <strong>{preview.sourceOrgName}</strong>. Is this the same person as {participantName}?
                      </p>
                      {error && <div className="alert alert-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-ghost" onClick={() => setPreview(null)}>No, cancel</button>
                        <button className="btn btn-primary" disabled={confirmLink.isPending}
                          onClick={() => confirmLink.mutate()}>
                          {confirmLink.isPending ? <span className="spinner" /> : 'Yes, link the records'}
                        </button>
                      </div>
                    </div>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }} onClick={resetFlow}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
