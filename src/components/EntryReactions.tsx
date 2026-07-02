import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { LogEntryReaction } from '../types/database'

const REACTIONS: { key: LogEntryReaction['reaction']; emoji: string }[] = [
  { key: 'thumbs_up', emoji: '👍' },
  { key: 'heart', emoji: '❤️' },
]

export default function EntryReactions({ entryId }: { entryId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data: reactions = [] } = useQuery({
    queryKey: ['entry-reactions', entryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('log_entry_reactions')
        .select('*')
        .eq('entry_id', entryId)
      if (error) throw error
      return data as LogEntryReaction[]
    },
  })

  async function toggle(reaction: LogEntryReaction['reaction']) {
    if (!user) return
    const mine = reactions.find((r) => r.reaction === reaction && r.author_id === user.id)
    if (mine) {
      await supabase.from('log_entry_reactions').delete().eq('id', mine.id)
    } else {
      await supabase.from('log_entry_reactions').insert({ entry_id: entryId, author_id: user.id, reaction })
    }
    qc.invalidateQueries({ queryKey: ['entry-reactions', entryId] })
  }

  return (
    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
      {REACTIONS.map(({ key, emoji }) => {
        const count = reactions.filter((r) => r.reaction === key).length
        const mine = reactions.some((r) => r.reaction === key && r.author_id === user?.id)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.15rem 0.5rem', borderRadius: 20, cursor: 'pointer',
              fontSize: '0.78rem', fontWeight: 600,
              border: `1px solid ${mine ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: mine ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'none',
              color: mine ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            <span>{emoji}</span>
            {count > 0 && <span>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
