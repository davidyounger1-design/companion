import { useNavigate } from 'react-router-dom'

const APP_VERSION = '0.5.34'

const RELEASES = [
  {
    version: '0.5.34',
    date: '4 July 2026',
    title: 'The "up next" banner is recipient-only again',
    changes: [
      { type: 'fix', text: 'The persistent "up next" strip on Journal, Notices, and Help no longer shows for coordinator or family logins — it\'s a recipient-only feature. The Schedule page\'s own "up next" card is unaffected and still shows for everyone managing the schedule' },
    ],
  },
  {
    version: '0.5.33',
    date: '4 July 2026',
    title: 'The actual, actual fix for the Save button',
    changes: [
      { type: 'fix', text: 'The "Add to schedule" / "Start a timer" sheets and the journal\'s date-filter calendar shared the exact z-index of the bottom navigation bar — the nav bar was winning the tie and painting over the bottom of the sheet, hiding the Save button behind it. Sheets now sit clearly above the nav bar' },
    ],
  },
  {
    version: '0.5.32',
    date: '4 July 2026',
    title: 'Fix the schedule form\'s Save button for real this time',
    changes: [
      { type: 'fix', text: 'The "Add to schedule" and "Start a timer" sheets had a layout bug that pushed the Save button fully out of view on longer forms, regardless of the keyboard — fixed the underlying cause' },
    ],
  },
  {
    version: '0.5.31',
    date: '4 July 2026',
    title: 'Forms no longer hide behind the keyboard',
    changes: [
      { type: 'fix', text: 'Bottom sheets and dialogs (add/edit schedule item, start a timer, edit journal entry) now lift clear of the on-screen keyboard instead of hiding the Save button behind it' },
    ],
  },
  {
    version: '0.5.30',
    date: '4 July 2026',
    title: 'Text size control, and easier-to-reach buttons',
    changes: [
      { type: 'new', text: 'Everyone can now set their own text size — look for the gear icon next to Sign out, or Display in the coordinator menu. Bigger or smaller, it applies across the whole app on this device' },
      { type: 'fix', text: 'The Save/Cancel buttons on "Add to schedule" and "Start a timer" now stay stuck to the bottom of the sheet instead of requiring a scroll to reach' },
    ],
  },
  {
    version: '0.5.29',
    date: '4 July 2026',
    title: 'A real countdown in the "up next" ring',
    changes: [
      { type: 'fix', text: 'The countdown ring on "up next" items now shows time remaining until it starts (e.g. "45m" or "2h"), not just a category icon' },
    ],
  },
  {
    version: '0.5.28',
    date: '4 July 2026',
    title: 'The "up next" hero now stays put everywhere',
    changes: [
      { type: 'fix', text: 'On Schedule and Timer, the "happening now / up next" card now stays stuck to the header when you scroll, matching Journal, Notices, and Help' },
    ],
  },
  {
    version: '0.5.27',
    date: '4 July 2026',
    title: 'The "up next" banner now stays put',
    changes: [
      { type: 'fix', text: 'The "what\'s on now" banner on Journal, Notices, and Help now stays stuck to the top with the header when you scroll, instead of scrolling away' },
    ],
  },
  {
    version: '0.5.26',
    date: '4 July 2026',
    title: 'The new look, everywhere',
    changes: [
      { type: 'new', text: 'Journal entries now show a colourful icon for their type (meal, activity, mood, note, photo) with a matching accent stripe, instead of an emoji' },
      { type: 'change', text: 'Notices use the same card style everywhere they appear — the Notice Board and the Journal\'s "active notices" preview' },
      { type: 'change', text: 'The "add entry" button on the Journal is now a floating action button, matching the Schedule' },
      { type: 'change', text: 'The "happening now" countdown ring now shows the minutes remaining for the current activity' },
      { type: 'fix', text: 'The schedule\'s "mark as done" circle is now clearly visible before it\'s checked' },
    ],
  },
  {
    version: '0.5.25',
    date: '4 July 2026',
    title: 'A new look for the schedule and timer',
    changes: [
      { type: 'new', text: 'Schedule items now show a colourful icon for their category instead of an emoji badge, with a satisfying animated checkmark when marked done' },
      { type: 'new', text: 'The "happening now" banner is now a bold status card with a countdown ring — shared by the Schedule and Timer pages' },
      { type: 'change', text: 'The Day/Week switch and the timer\'s clock-style switch now use a smoother sliding toggle' },
      { type: 'change', text: 'The "add to schedule" button is now a floating action button, matching the new look' },
    ],
  },
  {
    version: '0.5.24',
    date: '4 July 2026',
    title: 'Your theme, everywhere',
    changes: [
      { type: 'change', text: 'Your chosen timer theme now colours the whole app — Journal, Schedule, Notices, and Help all pick up a subtle wash of the same colours, instead of just the Timer screen' },
      { type: 'new', text: 'Floating theme decorations (fish, stars, sweets, and more) now appear on the schedule\'s "up next" banner too' },
    ],
  },
  {
    version: '0.5.23',
    date: '4 July 2026',
    title: 'A tidier look, and a Today button',
    changes: [
      { type: 'new', text: 'Added a "Today" shortcut to the schedule\'s Day/Week selector' },
      { type: 'fix', text: 'Notices now match the app\'s look everywhere, instead of a bright yellow sticky-note style that didn\'t fit' },
      { type: 'change', text: 'Consistent icons across Journal, Schedule, Timer, and Notices, replacing a mix of emoji with the same clean style already used in the bottom navigation' },
    ],
  },
  {
    version: '0.5.22',
    date: '3 July 2026',
    title: 'A timer that follows you, and themes to make it yours',
    changes: [
      { type: 'new', text: 'A "what\'s on now" banner appears across Journal, Notices, Help, and the Timer — always shows the current or next scheduled item' },
      { type: 'new', text: 'Family and coordinators can start a timer remotely for the person they support — it appears counting down on their Timer screen automatically, no action needed from them' },
      { type: 'new', text: 'Choose between a clock face or a digital countdown, and theme your timer — Ocean, Space, Rainbow, Candy, Garden, Sunset, or Classic — each with its own colours and floating decorations' },
    ],
  },
  {
    version: '0.5.21',
    date: '3 July 2026',
    title: 'Week view for the schedule',
    changes: [
      { type: 'new', text: 'Switch the day schedule to a Week view to see the whole week at a glance, then tap any day to open it in full' },
    ],
  },
  {
    version: '0.5.20',
    date: '3 July 2026',
    title: 'Visual timer',
    changes: [
      { type: 'new', text: 'A new Timer tool for care recipients — a colourful shrinking disk that makes time easy to feel, not just read, with a chime, vibration, and pulse when it\'s done' },
      { type: 'new', text: 'The day schedule\'s "up next" banner and current activity now show the same shrinking disk, and any item has a one-tap "Start a timer for this"' },
    ],
  },
  {
    version: '0.5.19',
    date: '3 July 2026',
    title: 'Day schedule',
    changes: [
      { type: 'new', text: 'Family and coordinators can build a day schedule — once-off or repeating weekly — for the person they support' },
      { type: 'new', text: 'A colourful, live "what\'s on and what\'s next" schedule view, with notes on any item and a done checkmark for the day' },
    ],
  },
  {
    version: '0.5.18',
    date: '3 July 2026',
    title: 'Care recipients no longer have Messages',
    changes: [
      { type: 'change', text: 'Care recipients no longer see a Messages tab — messaging isn\'t part of their experience' },
      { type: 'fix', text: 'Opening Messages as a care recipient no longer bounced you into the support worker area' },
    ],
  },
  {
    version: '0.5.17',
    date: '2 July 2026',
    title: 'React to entries, edit only your own',
    changes: [
      { type: 'new', text: 'Add a 👍 or ❤️ to any journal entry you can see' },
      { type: 'fix', text: "You can now only edit journal entries you wrote yourself — editing someone else's entry is no longer possible" },
    ],
  },
  {
    version: '0.5.16',
    date: '2 July 2026',
    title: 'Lock the coordinator dashboard to coordinators',
    changes: [
      { type: 'fix', text: 'The coordinator dashboard now checks your role before showing anything — care recipients, family, and support workers are sent to their own home screen instead' },
    ],
  },
  {
    version: '0.5.15',
    date: '2 July 2026',
    title: 'Fix care recipient login',
    changes: [
      { type: 'fix', text: 'Care recipients signing in no longer get bounced to the coordinator dashboard — a missing case sent them there right after correctly loading their journal' },
    ],
  },
  {
    version: '0.5.14',
    date: '2 July 2026',
    title: 'Member emails visible on Members page',
    changes: [
      { type: 'fix', text: 'Each member\'s email now shows on the Members page — it was already designed to display but the server was never sending it' },
    ],
  },
  {
    version: '0.5.13',
    date: '2 July 2026',
    title: 'Care recipients can use the full journal',
    changes: [
      { type: 'new', text: 'Care recipients can now view and add entries in their own care journal — meals, activities, mood, notes, and photos — and comment on them, the same as a family member' },
      { type: 'change', text: 'Care recipients now land on the same journal view as family, instead of a separate simplified page' },
    ],
  },
  {
    version: '0.5.12',
    date: '2 July 2026',
    title: 'Comment on journal entries',
    changes: [
      { type: 'new', text: 'Add comments to any journal entry you can see — coordinators, family, and support workers can now discuss entries directly on the entry itself' },
    ],
  },
  {
    version: '0.5.11',
    date: '2 July 2026',
    title: 'Care recipients can log in',
    changes: [
      { type: 'new', text: 'The person being cared for can now get their own login — invite them from Members as a "Care recipient"' },
      { type: 'new', text: 'Care recipients can leave feedback about their own care, visible to their coordinator, family, and support team' },
    ],
  },
  {
    version: '0.5.10',
    date: '28 June 2026',
    title: 'Quieter updates',
    changes: [
      { type: 'fix', text: 'New versions now install quietly and apply the next time you open the app — no more repeated "update now" banner' },
    ],
  },
  {
    version: '0.5.9',
    date: '28 June 2026',
    title: 'Help badge points to your ticket',
    changes: [
      { type: 'fix', text: 'The number on the Help tab counts support tickets awaiting your reply — tapping Help now opens the Support tab directly, and that tab shows the count, so it\'s clear what needs attention' },
    ],
  },
  {
    version: '0.5.8',
    date: '28 June 2026',
    title: 'New invites show immediately',
    changes: [
      { type: 'fix', text: 'A newly sent invite now appears in the pending-invites list right away, without needing to refresh' },
    ],
  },
  {
    version: '0.5.7',
    date: '28 June 2026',
    title: 'Family can see pending invites',
    changes: [
      { type: 'new', text: 'Family members can now see the list of pending invites on the Members page (read-only) — resending and rescinding stay with coordinators' },
    ],
  },
  {
    version: '0.5.6',
    date: '28 June 2026',
    title: 'Rescind pending invites',
    changes: [
      { type: 'new', text: 'Coordinators can now rescind a pending invite from the Members page — the invite link stops working immediately' },
    ],
  },
  {
    version: '0.5.5',
    date: '28 June 2026',
    title: 'Help split into tabs',
    changes: [
      { type: 'new', text: 'Help now has three tabs — Articles, Support, and Ideas — so each is on its own screen instead of one long page' },
    ],
  },
  {
    version: '0.5.4',
    date: '28 June 2026',
    title: 'Help shows only Companion articles',
    changes: [
      { type: 'fix', text: 'The Help page now shows only Companion articles — other products and general platform pages (e.g. Leave Planner, pricing) no longer appear' },
      { type: 'fix', text: 'Support tickets & ideas now sits at the top of the Help page so it\'s easy to find' },
    ],
  },
  {
    version: '0.5.3',
    date: '28 June 2026',
    title: 'Help is easier to find',
    changes: [
      { type: 'new', text: 'The Help page (with how-to articles) is now reachable from every role — the family Help tab opens it, and coordinators have a new Help link in the dashboard' },
      { type: 'new', text: 'Added a "Contact support & ideas" link on the Help page so you can open a ticket or share a feature idea from one place' },
    ],
  },
  {
    version: '0.5.2',
    date: '28 June 2026',
    title: 'Groundwork for role-tailored help',
    changes: [
      { type: 'fix', text: 'Behind the scenes: help articles can now be tailored to your role — takes effect automatically once articles are tagged (no change to what you see today)' },
    ],
  },
  {
    version: '0.5.1',
    date: '28 June 2026',
    title: 'Help articles & Help & Feedback fixes',
    changes: [
      { type: 'new', text: 'The Help page now shows live help articles — tap any to read it, and they load instantly from a cached copy then refresh in the background' },
      { type: 'fix', text: 'Help & Feedback widgets now load reliably — removed an overzealous timeout that could hide the working support and ideas forms' },
      { type: 'fix', text: 'Installed app now refreshes to the latest version more reliably' },
    ],
  },
  {
    version: '0.5.0',
    date: '28 June 2026',
    title: 'App now follows your platform branding',
    changes: [
      { type: 'new', text: 'Companion now picks up the accent colour, corner style, and fonts set for it in MyAppBuddy — change the branding there and the app updates to match' },
    ],
  },
  {
    version: '0.4.9',
    date: '28 June 2026',
    title: 'Fix journal entries spinning indefinitely',
    changes: [
      { type: 'fix', text: 'Family plan journal no longer spins forever — fixed a query key that changed on every render, causing a fetch loop' },
    ],
  },
  {
    version: '0.4.8',
    date: '28 June 2026',
    title: 'Fix Help & Feedback loading on iOS',
    changes: [
      { type: 'fix', text: 'Help & Feedback widgets now load correctly on iOS — switched from dynamic to static script loading which iOS PWA mode requires' },
    ],
  },
  {
    version: '0.4.7',
    date: '28 June 2026',
    title: '30-day journal retention for Family plan',
    changes: [
      { type: 'new', text: 'Free Family plan: journal entries are kept for 30 days — each entry shows how many days remain' },
      { type: 'new', text: 'Entries expiring within 7 days are highlighted in orange; the last 2 days show red' },
      { type: 'new', text: 'Expired entries and their photos are automatically deleted when you open the journal' },
    ],
  },
  {
    version: '0.4.6',
    date: '28 June 2026',
    title: 'Upload & help screen fixes',
    changes: [
      { type: 'fix', text: 'Photo and video uploads now work — fixed file type restrictions that were blocking all uploads' },
      { type: 'fix', text: 'Help & feedback now shows a "Try again" button if the widgets fail to load' },
    ],
  },
  {
    version: '0.4.5',
    date: '28 June 2026',
    title: 'Bug fixes — image upload & help screen',
    changes: [
      { type: 'fix', text: 'Journal photo/video upload now works correctly — fixed a file type error that blocked uploads' },
      { type: 'fix', text: 'Help & feedback page no longer shows blank when widgets fail to load — shows a helpful fallback message instead' },
    ],
  },
  {
    version: '0.4.4',
    date: '28 June 2026',
    title: 'Live journal updates & privacy pages',
    changes: [
      { type: 'new', text: 'Journal entries appear in real time — no refresh needed when someone else adds an entry' },
      { type: 'new', text: 'Privacy Policy and Terms of Service pages now live at myappbuddy.com.au' },
      { type: 'fix', text: 'App version in footer now always stays in sync with the release notes' },
    ],
  },
  {
    version: '0.4.3',
    date: '28 June 2026',
    title: 'Support thread view, footer & wider layout',
    changes: [
      { type: 'new', text: 'Support ticket thread view — tap any ticket to read the full conversation and send a reply' },
      { type: 'new', text: 'Automatic update banner — a prompt appears when a new version of Companion is ready' },
      { type: 'new', text: '"Check for updates" in ⋯ menu — manually trigger an update at any time' },
      { type: 'new', text: 'Footer on every page — shows copyright, app version, Privacy and Terms links' },
      { type: 'change', text: 'Content cards are now wider to make better use of available screen space' },
      { type: 'fix', text: 'Help & feedback page was blank — fixed a browser compatibility issue with embedded widgets' },
    ],
  },
  {
    version: '0.4.2',
    date: '28 June 2026',
    title: 'Help & feedback polish',
    changes: [
      { type: 'new', text: 'Help nav badge — shows a count when a support ticket has been replied to' },
      { type: 'new', text: 'Support ticket list shows a preview of each message body' },
      { type: 'new', text: 'Replied tickets highlighted green with a reply indicator' },
      { type: 'new', text: 'App version number visible in the ⋯ menu' },
      { type: 'fix', text: 'Delete journal entry now works correctly' },
      { type: 'fix', text: 'Help & feedback page was blank on browser refresh' },
      { type: 'fix', text: 'Push notification banner no longer shows on desktop PCs' },
    ],
  },
  {
    version: '0.4.1',
    date: '27 June 2026',
    title: 'PWA & coordinator tools',
    changes: [
      { type: 'new', text: 'Progressive Web App — install Companion to your home screen on iOS and Android' },
      { type: 'new', text: '⋯ menu for coordinators — quick access to Members, Permissions, and Release notes' },
      { type: 'new', text: 'Larger, more visible ⋯ menu button' },
    ],
  },
  {
    version: '0.2.0',
    date: '27 June 2026',
    title: 'Mood tracking, media, messaging & more',
    changes: [
      { type: 'new', text: 'Mood meter on every journal entry — rate from 😔 to 😊' },
      { type: 'new', text: 'Mood tracker chart on dashboard — visualise mood over time' },
      { type: 'new', text: 'Notice board — post important notices visible to the whole care team' },
      { type: 'new', text: 'Messaging — direct chat between workers and coordinator; family group thread' },
      { type: 'new', text: 'Video uploads — attach a short video to any journal entry' },
      { type: 'new', text: 'Full-screen media viewer — tap any photo or video to expand' },
      { type: 'new', text: 'Click-to-edit journal entries for coordinator, family, and workers (own entries)' },
      { type: 'new', text: 'Resend invite link for pending members' },
      { type: 'new', text: 'Permissions matrix — coordinators can configure what each role can do' },
      { type: 'fix', text: 'Workers now only see their own journal entries' },
      { type: 'fix', text: 'Removing a member now deletes their login account' },
      { type: 'fix', text: 'Sign out button label was truncated — now shows "Sign out" in full' },
      { type: 'fix', text: 'Photo button did nothing on desktop — now opens file picker correctly' },
    ],
  },
  {
    version: '0.1.0',
    date: '26 June 2026',
    title: 'Initial release',
    changes: [
      { type: 'new', text: 'Family journal with Meal, Activity, Mood, Note entry types' },
      { type: 'new', text: 'Invite-based onboarding — click link, set password, land in journal' },
      { type: 'new', text: 'Worker portal with client list and shift logging' },
      { type: 'new', text: 'Coordinator dashboard with member management' },
      { type: 'new', text: 'Photo attachment on all entry types' },
      { type: 'new', text: 'Author attribution on all journal entries' },
    ],
  },
]

const TYPE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: 'New', color: '#2e7d52', bg: '#e8f5ee' },
  fix: { label: 'Fix', color: '#c06b1a', bg: '#fef3e2' },
  change: { label: 'Changed', color: '#5b5ea6', bg: '#efeffd' },
}

export { APP_VERSION }

export default function ReleaseNotes() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '1rem 1rem 0.75rem',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0,
        background: 'var(--color-bg)', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: '0.75rem',
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Release notes</h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: 0 }}>
            Companion v{APP_VERSION}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {RELEASES.map((rel) => (
          <div key={rel.version} style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>v{rel.version}</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{rel.date}</span>
              {rel.version === APP_VERSION && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', background: 'var(--color-primary)', color: '#fff',
                  padding: '0.1rem 0.4rem', borderRadius: 4,
                }}>current</span>
              )}
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>{rel.title}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {rel.changes.map((c, i) => {
                const badge = TYPE_BADGE[c.type] ?? TYPE_BADGE.change
                return (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0, fontSize: '0.65rem', fontWeight: 700,
                      padding: '0.15rem 0.45rem', borderRadius: 4,
                      background: badge.bg, color: badge.color,
                      letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 2,
                    }}>{badge.label}</span>
                    <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
