import { useNavigate } from 'react-router-dom'
import { APP_VERSION } from '../lib/version'

const RELEASES = [
  {
    version: '0.5.57',
    date: '6 July 2026',
    title: 'Install & updates in Settings, and PWA opens straight in',
    changes: [
      { type: 'new', text: 'Settings now has an "Install app" section (hidden once installed), a version-aware "Check for updates" that tells you which version it\'s moving to, plus quick links to What\'s new, Permissions, and your Subscription' },
      { type: 'change', text: 'Opening the installed app now takes you straight into Companion instead of the marketing page' },
    ],
  },
  {
    version: '0.5.56',
    date: '6 July 2026',
    title: 'Edit member details, and notifications moved to Settings',
    changes: [
      { type: 'new', text: 'Coordinators can now edit any member\'s name and mobile number — tap the ✏️ on a member in the Members list' },
      { type: 'change', text: 'Notification controls (turn on notifications, and "new entry alerts") now live in Settings → Notifications, instead of on the Journal' },
    ],
  },
  {
    version: '0.5.55',
    date: '6 July 2026',
    title: 'Settings menu, update prompt, and a menu fix',
    changes: [
      { type: 'change', text: 'The "Display" menu item is now "Settings" (⚙️) — it covers appearance, text size, your mobile number, and two-factor authentication, not just display' },
      { type: 'new', text: 'When a new version is released, you\'ll now see a "new version ready" bar with a Refresh button that updates the app on the spot, instead of waiting for a silent update on some later launch' },
      { type: 'fix', text: 'The top-right menu no longer appears behind the "up next" card' },
    ],
  },
  {
    version: '0.5.54',
    date: '6 July 2026',
    title: 'Security hardening',
    changes: [
      { type: 'change', text: 'Strengthened the safeguards around accounts, organisation membership, and invitations behind the scenes. No change to how you use the app' },
    ],
  },
  {
    version: '0.5.53',
    date: '6 July 2026',
    title: 'Stop counting unread messages from removed members',
    changes: [
      { type: 'fix', text: 'The unread badge could sit one (or more) higher than the Messages list forever — it was counting unread messages from people who\'ve since been removed from the organisation, whose conversations no longer appear in the list at all. Those are now excluded, so the badge always matches what you can actually see and open' },
    ],
  },
  {
    version: '0.5.52',
    date: '5 July 2026',
    title: 'Unify the unread message count',
    changes: [
      { type: 'fix', text: 'The nav\'s unread badge and the per-contact counts on Messages were two separately-polled counters that could briefly disagree — they now share one underlying count so they can\'t drift apart' },
    ],
  },
  {
    version: '0.5.51',
    date: '5 July 2026',
    title: 'Name an invite, and a fix for misleading unread counts',
    changes: [
      { type: 'new', text: 'Invites now ask for the person\'s name — pending invites show who they actually are instead of just an email address, the invite email greets them by name, and their sign-up form is pre-filled (still editable)' },
      { type: 'fix', text: 'Fixed unread message badges (the nav icon and per-contact counts) sometimes counting conversations between two other people that a coordinator or family member could merely see, not messages actually sent to them' },
    ],
  },
  {
    version: '0.5.50',
    date: '5 July 2026',
    title: 'Add a website to a scheduled activity',
    changes: [
      { type: 'new', text: 'Any schedule item can now include an optional website link — a video call, a venue\'s page, a sign-up form — shown as a "Visit website" button on the schedule and on the "up next" card' },
    ],
  },
  {
    version: '0.5.49',
    date: '5 July 2026',
    title: 'Message privacy now matches your organisation type',
    changes: [
      { type: 'fix', text: 'In provider organisations (multiple participants), coordinators now only see the shared threads and conversations that involve a coordinator or a worker — a family member\'s private conversation with another family member or a therapist stays private, the way it already worked for family-plan accounts' },
      { type: 'change', text: 'Family-plan accounts (a single participant) are unaffected — the coordinator there still sees every conversation, since it\'s typically the same small circle' },
    ],
  },
  {
    version: '0.5.48',
    date: '5 July 2026',
    title: 'Tighter message privacy, workers out of the schedule, timers that take over the screen',
    changes: [
      { type: 'fix', text: 'Support workers and therapists could previously read every message in the org directly via the API, not just their own conversations — messages are now restricted to threads you\'re actually part of, unless you\'re a coordinator or family member' },
      { type: 'fix', text: 'Workers can no longer open the family schedule or timer pages at all, on top of already being excluded from that data — it was never part of their portal to begin with' },
      { type: 'new', text: 'When family or a coordinator starts a timer for the recipient, it now pops up full-screen on their device automatically, instead of waiting for them to notice and tap a small banner' },
    ],
  },
  {
    version: '0.5.47',
    date: '5 July 2026',
    title: 'Two-factor authentication',
    changes: [
      { type: 'new', text: 'Added optional two-factor authentication under Display settings — scan a QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc.) and you\'ll be asked for a 6-digit code after your password when signing in' },
      { type: 'new', text: 'Free, no SMS required — real text-message login would need a paid provider account, so this uses the same authenticator-app codes most banks use, at no cost' },
    ],
  },
  {
    version: '0.5.46',
    date: '5 July 2026',
    title: 'Cancel invites properly, and add a mobile number',
    changes: [
      { type: 'fix', text: 'Fixed the pending invites list on Members cutting off the Resend button and hiding the cancel (✕) button on narrower screens — both are now always visible' },
      { type: 'new', text: 'Invites can now include a mobile number — after sending, a "Text invite" button opens your own Messages app with the link pre-filled, so you can send it yourself alongside the email' },
      { type: 'new', text: 'Added a mobile number field to Display settings so any member can save their own number for this' },
    ],
  },
  {
    version: '0.5.45',
    date: '5 July 2026',
    title: 'Behaviour notes: capture, share, and track — for real',
    changes: [
      { type: 'new', text: 'Support workers can now record behaviour notes (antecedent, behaviour, response, mood before/after) for the clients they work with' },
      { type: 'new', text: 'A therapist role now has its own home — sign in and see only the notes a decision-maker has explicitly shared, with instant revoke' },
      { type: 'new', text: 'Decision-makers can now be assigned per participant from the Coordinator dashboard, and can share or revoke access to each note with named therapists' },
      { type: 'new', text: 'Every share, revoke, and therapist view is now recorded in a visible access log for the decision-maker and coordinator' },
      { type: 'new', text: 'A pattern view shows mood trends over time, and notes can be exported to CSV for reviews and reports' },
      { type: 'new', text: 'Coordinators and family members can invite a therapist directly from Members — accepting the invite now correctly adds them to the participant\'s circle' },
    ],
  },
  {
    version: '0.5.44',
    date: '4 July 2026',
    title: 'Recipients can add their own schedule, and count down to any appointment',
    changes: [
      { type: 'new', text: 'Recipients can now add their own appointments and activities to their schedule, and edit or remove the ones they added — items their family or coordinator added stay theirs to manage' },
      { type: 'new', text: 'On the Timer page, pick anything coming up today and the timer counts down to exactly when it starts — no need to work out the minutes yourself' },
      { type: 'change', text: 'The Timer\'s clock and colours now follow the same Light/Dark/Auto appearance as the rest of the app, instead of a separate clock theme' },
    ],
  },
  {
    version: '0.5.43',
    date: '4 July 2026',
    title: 'The header and "up next" banner now follow you everywhere',
    changes: [
      { type: 'change', text: 'Every page in the family/recipient portal — Schedule, Notices, Timer, Add entry, Edit participant, and Messages — now keeps the same top bar (logo, appearance pill, settings, sign out) instead of only showing it on the Journal' },
      { type: 'change', text: 'The "up next" schedule banner for recipients now follows onto every one of those pages too, not just Journal, Schedule, Notices, and Help' },
    ],
  },
  {
    version: '0.5.42',
    date: '4 July 2026',
    title: 'Removed the colour theme picker',
    changes: [
      { type: 'change', text: 'The Ocean/Space/Rainbow/Candy/Garden/Sunset colour theme picker has been removed from both Display settings and the Timer page — everyone now gets the same consistent look' },
    ],
  },
  {
    version: '0.5.41',
    date: '4 July 2026',
    title: 'Clearer label for the app-wide colour theme',
    changes: [
      { type: 'change', text: 'Renamed "Theme your clock" to "App colour theme" on the Timer page and added a note explaining it colours every page, not just the Timer — it always worked this way, but the old label made it sound Timer-only' },
    ],
  },
  {
    version: '0.5.40',
    date: '4 July 2026',
    title: 'Light, dark, and auto appearance — plus a fix for missing install options',
    changes: [
      { type: 'new', text: 'Choose Light, Dark, or Auto (follows your device) in Display settings — a small pill in the top bar shows which one is active and can be tapped to switch' },
      { type: 'new', text: 'The clock colour theme picker is now also available from Display settings, not just the Timer page' },
      { type: 'fix', text: 'iPads showing as a Mac to Safari were never offered the "Add to home screen" install option — they now are' },
      { type: 'fix', text: 'Android browsers that never showed the automatic install prompt (or where it was dismissed once) now get manual "Add to home screen" instructions instead of nothing' },
    ],
  },
  {
    version: '0.5.39',
    date: '4 July 2026',
    title: 'Feedback is now clearly a private note to the care team',
    changes: [
      { type: 'change', text: 'The "Leave feedback" box on a participant\'s Journal now says plainly that it\'s a private note for the care team — the recipient it\'s about won\'t see it' },
      { type: 'fix', text: 'Recipients no longer see the Feedback section on their own Journal at all, since it\'s notes their care team writes about them, not for them' },
    ],
  },
  {
    version: '0.5.38',
    date: '4 July 2026',
    title: 'Fix the header overflowing on narrow phones',
    changes: [
      { type: 'fix', text: 'On narrow screens (and especially with a larger text size set), the name/email next to Sign out could push the Settings and Sign out buttons off to the side. The name and email now truncate instead of overflowing' },
    ],
  },
  {
    version: '0.5.37',
    date: '4 July 2026',
    title: 'Your timer follows you, and entry dates are clearer',
    changes: [
      { type: 'fix', text: 'Care recipients now see their running timer counting down on every page — Journal, Schedule, Notices, and Help — not just on the Timer page itself' },
      { type: 'change', text: 'Journal entries are now grouped by full day and date (e.g. "Today · Saturday 4 July") instead of just "Today" or a short date' },
    ],
  },
  {
    version: '0.5.36',
    date: '4 July 2026',
    title: 'Mood log now shows an error if saving fails',
    changes: [
      { type: 'fix', text: 'The mood check-in\'s Save button failed silently if something went wrong — it now shows what happened instead of appearing to do nothing' },
    ],
  },
  {
    version: '0.5.35',
    date: '4 July 2026',
    title: 'Filter entries your way, and a mood check-in just for recipients',
    changes: [
      { type: 'new', text: 'Filter journal entries by Today, This week, a date range, or a specific date — tap the filter chip above the entries list' },
      { type: 'new', text: 'Care recipients can now log their own mood whenever they like from a new card on the Journal — visible to everyone with access to them' },
      { type: 'change', text: 'Care recipients no longer see the mood rating attached to entries other people log — that\'s replaced by their own self-reported mood check-in' },
    ],
  },
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
