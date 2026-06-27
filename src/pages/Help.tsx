import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Section = { icon: string; title: string; body: string }

const GUIDE: Record<string, { heading: string; sections: Section[] }> = {
  coordinator: {
    heading: 'Coordinator guide',
    sections: [
      {
        icon: '👥',
        title: 'Managing members',
        body: 'Go to Members (top of the journal screen) to invite family members, support workers, and therapists. Send invite links by email — they click the link and land straight in the app. Use the ↑/↓ arrows to promote or demote a member\'s role, and ✕ to remove them entirely.',
      },
      {
        icon: '🔐',
        title: 'Permissions',
        body: 'Go to Settings → Permissions to control exactly what each role can do. For example you can prevent support workers from editing entries, or allow family members to post notices. Changes take effect immediately.',
      },
      {
        icon: '📔',
        title: 'Journal',
        body: 'The family journal shows all entries logged by everyone in the care circle. Click any entry to edit it. Use the + Add button to log a new meal, activity, mood, or note — you can attach a photo or video to any entry type.',
      },
      {
        icon: '📊',
        title: 'Mood tracker',
        body: 'The mood chart on the dashboard shows the participant\'s average mood score each day over the last 14 days. Each log entry has a mood slider (😔 to 😊) — the chart averages all entries for the day.',
      },
      {
        icon: '📌',
        title: 'Notice board',
        body: 'Post important notices (appointments, reminders, alerts) from the 📌 button on the dashboard. Notices appear prominently at the top of every team member\'s view.',
      },
      {
        icon: '💬',
        title: 'Messages',
        body: 'The messages tab opens the hub showing all org members. Tap any person for a direct thread, or tap the family group for the shared thread visible to all family members and coordinators.',
      },
      {
        icon: '↩️',
        title: 'Resending invites',
        body: 'In the Members page, pending invites appear at the top with a Resend button. Use this if someone didn\'t receive the email or the link expired.',
      },
    ],
  },
  family: {
    heading: 'Family guide',
    sections: [
      {
        icon: '📔',
        title: 'Adding entries',
        body: 'Tap + Add to log a moment from the day. Choose a type (Meal, Activity, Mood, or Note), write a short description, set the mood slider, and optionally attach a photo or video. Tap any entry to edit it.',
      },
      {
        icon: '😊',
        title: 'Mood tracking',
        body: 'Every entry has a mood slider from 😔 (0) to 😊 (100). The dashboard shows a chart of mood over the last 14 days. Default is 50 — move it up or down to reflect how the participant was feeling.',
      },
      {
        icon: '🖼️',
        title: 'Photos & videos',
        body: 'Every entry type can have a photo or video attached. On your phone, you can take a photo from the camera or pick one from your gallery. Tap any photo in the journal to view it full-screen.',
      },
      {
        icon: '📌',
        title: 'Notice board',
        body: 'Tap the 📌 button to open the notice board. Post important reminders (appointments, dietary changes, things to remember). Notices show at the top of the journal for everyone.',
      },
      {
        icon: '💬',
        title: 'Messages',
        body: 'Tap the 💬 button to open the message hub. Send a direct message to any team member, or use the family group thread for shared updates visible to all family members and the coordinator.',
      },
    ],
  },
  trusted_support_worker: {
    heading: 'Worker guide',
    sections: [
      {
        icon: '📋',
        title: 'Logging entries',
        body: 'Open a client from your client list, then tap + Add log entry. Choose the type, write a description, set the mood, and optionally attach a photo or video. Your entries appear in "Today so far". Tap any of your entries to edit them.',
      },
      {
        icon: '😊',
        title: 'Mood rating',
        body: 'Every log entry includes a mood rating slider (😔 to 😊, 0–100). Set it to reflect how the participant seemed during that moment. Default is 50 — move it to reflect reality.',
      },
      {
        icon: '📌',
        title: 'Notice board',
        body: 'Check the notice board (📌 in the bottom nav) for important notices from the coordinator or family. You can also post notices — useful for shift handover notes.',
      },
      {
        icon: '💬',
        title: 'Messages',
        body: 'Use the messages tab (💬 in the bottom nav) to message any team member directly, or the family group thread.',
      },
    ],
  },
  support_worker: {
    heading: 'Worker guide',
    sections: [
      {
        icon: '📋',
        title: 'Logging entries',
        body: 'Open a client from your client list, then tap + Add log entry. Choose the type, write a description, set the mood, and optionally attach a photo or video. Your entries appear in "Today so far". Tap any of your entries to edit them.',
      },
      {
        icon: '😊',
        title: 'Mood rating',
        body: 'Every log entry includes a mood rating slider (😔 to 😊, 0–100). Set it to reflect how the participant seemed during that moment. Default is 50.',
      },
      {
        icon: '💬',
        title: 'Messages',
        body: 'Use the messages tab (💬 in the bottom nav) to send a direct message to the coordinator or other team members.',
      },
    ],
  },
  therapist: {
    heading: 'Therapist guide',
    sections: [
      {
        icon: '📔',
        title: 'Viewing the journal',
        body: 'You can view journal entries for participants in your care circle. The coordinator shares access with you — contact them if you need visibility of additional clients.',
      },
      {
        icon: '💬',
        title: 'Messages',
        body: 'Use the messages feature to communicate directly with the coordinator or other team members.',
      },
    ],
  },
}

export default function Help() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const role = profile?.role ?? 'support_worker'
  const guide = GUIDE[role] ?? GUIDE.support_worker

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Help guide</h1>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '0 0 1rem' }}>
          {guide.heading}
        </p>

        {guide.sections.map((s) => (
          <div key={s.title} className="card" style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: 2 }}>{s.icon}</span>
              <div>
                <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.9375rem' }}>{s.title}</p>
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>{s.body}</p>
              </div>
            </div>
          </div>
        ))}

      </div>
    </div>
  )
}
