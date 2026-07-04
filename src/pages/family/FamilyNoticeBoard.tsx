import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import { MobileFooter } from '../../components/SiteFooter'
import { NoticesIcon, BackIcon } from '../../components/icons'
import NoticeCard from '../../components/NoticeCard'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function FamilyNoticeBoard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [newBody, setNewBody] = useState('')
  const [posting, setPosting] = useState(false)
  const isCoordinator = profile?.role === 'coordinator'

  const { data: clientId } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data?.client_id ?? null
    },
    enabled: !!user && (profile?.role === 'family' || profile?.role === 'coordinator'),
  })

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['client-notices', clientId ?? profile?.org_id],
    queryFn: async () => {
      let q = supabase
        .from('notices')
        .select('*, profiles!author_id(full_name)')
        .eq('org_id', profile!.org_id!)
        .order('created_at', { ascending: false })
      if (clientId) q = q.eq('client_id', clientId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.org_id,
  })

  async function postNotice() {
    if (!newBody.trim() || !user || !profile?.org_id || !clientId) return
    setPosting(true)
    try {
      await supabase.from('notices').insert({
        org_id: profile.org_id,
        client_id: clientId,
        author_id: user.id,
        body: newBody.trim(),
      })
      setNewBody('')
      qc.invalidateQueries({ queryKey: ['client-notices', clientId ?? profile.org_id] })
    } finally {
      setPosting(false)
    }
  }

  async function deleteNotice(id: string) {
    await supabase.from('notices').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['client-notices', clientId ?? profile?.org_id] })
  }

  return (
    <div style={{ paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{
        position: 'sticky', top: 'var(--family-header-h, 0px)', zIndex: 10,
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)',
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/family')}><BackIcon /></button>
        <h1 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <NoticesIcon size={20} /> Notice Board
        </h1>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>Post a notice</p>
          <textarea className="input" rows={3} value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="e.g. Sarah has a physio appointment on Friday at 10am"
            style={{ resize: 'vertical', marginBottom: '0.75rem' }} />
          <button className="btn btn-primary" onClick={postNotice}
            disabled={posting || !newBody.trim() || !clientId}
            style={{ fontSize: '0.875rem' }}>
            {posting ? <span className="spinner" /> : 'Post notice'}
          </button>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" style={{ color: 'var(--color-primary)' }} />
          </div>
        )}

        {!isLoading && notices.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
            <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'center' }}><NoticesIcon size={28} /></div>
            <p>No notices yet.</p>
          </div>
        )}

        {notices.map((n: any) => (
          <NoticeCard
            key={n.id}
            body={n.body}
            authorName={n.profiles?.full_name ?? 'Someone'}
            dateLabel={formatDate(n.created_at)}
            canDelete={n.author_id === user?.id || isCoordinator}
            onDelete={() => deleteNotice(n.id)}
          />
        ))}
        <MobileFooter />
      </div>
      <FamilyBottomNav />
    </div>
  )
}
