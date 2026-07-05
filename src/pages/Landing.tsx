import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import artGroupPhoto from '../assets/landing-art-group.jpg'

// ─── Phone mockup component ───────────────────────────────────────────────────

function PhoneMockup({ screen }: { screen: 'digest' | 'behaviour' }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 40,
      boxShadow: '0 24px 64px rgba(47,44,38,0.14), 0 4px 16px rgba(47,44,38,0.08)',
      padding: '12px 10px 20px',
      width: 280,
      maxWidth: '100%',
      border: '1.5px solid rgba(47,44,38,0.08)',
      position: 'relative',
    }}>
      {/* Status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 8px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-ui)' }}>9:41</span>
        <div style={{ width: 80, height: 20, background: '#111', borderRadius: 12 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><rect x="0" y="5" width="2" height="5" rx="1" fill="#2f2c26"/><rect x="3" y="3" width="2" height="7" rx="1" fill="#2f2c26"/><rect x="6" y="1" width="2" height="9" rx="1" fill="#2f2c26"/><rect x="9" y="0" width="2" height="10" rx="1" fill="#2f2c26"/></svg>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M7 2.5C9.2 2.5 11.1 3.4 12.5 4.8L13.5 3.8C11.9 2.1 9.6 1 7 1C4.4 1 2.1 2.1 0.5 3.8L1.5 4.8C2.9 3.4 4.8 2.5 7 2.5Z" fill="#2f2c26"/><path d="M7 5.5C8.4 5.5 9.7 6.1 10.6 7L11.6 6C10.4 4.8 8.8 4 7 4C5.2 4 3.6 4.8 2.4 6L3.4 7C4.3 6.1 5.6 5.5 7 5.5Z" fill="#2f2c26"/><circle cx="7" cy="9" r="1" fill="#2f2c26"/></svg>
          <svg width="22" height="10" viewBox="0 0 22 10" fill="none"><rect x="0" y="1" width="18" height="8" rx="2" stroke="#2f2c26" strokeWidth="1.2"/><rect x="1.5" y="2.5" width="12" height="5" rx="1" fill="#2f2c26"/><rect x="18.5" y="3.5" width="2" height="3" rx="1" fill="#2f2c26"/></svg>
        </div>
      </div>

      {screen === 'digest' ? <DigestScreen /> : <BehaviourScreen />}
    </div>
  )
}

function DigestScreen() {
  return (
    <div style={{ padding: '4px 12px', fontFamily: 'var(--font-ui)' }}>
      <p style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 4 }}>TUESDAY · 18 JUNE</p>
      <h3 style={{ fontSize: 15, fontFamily: 'var(--font-display)', fontWeight: 400, marginBottom: 10, lineHeight: 1.3 }}>
        Mia had a <em style={{ color: 'var(--color-primary)', fontStyle: 'italic' }}>bright</em> day.
      </h3>
      {/* Photo attached to the entry */}
      <div style={{
        borderRadius: 10,
        height: 100,
        marginBottom: 6,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <img src={artGroupPhoto} alt="Colourful paintbrushes from an art group session" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <span style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          background: 'rgba(255,255,255,0.9)',
          borderRadius: 20,
          padding: '2px 8px',
          fontSize: 9,
          color: 'var(--color-ink)',
          fontFamily: 'var(--font-mono)',
        }}>photo · art group</span>
      </div>
      {/* Worker note card */}
      <div style={{ background: '#fff', border: '1px solid #ece4d5', borderRadius: 10, padding: '8px 10px', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--color-primary-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#fff', fontWeight: 700 }}>JL</span>
          </div>
          <span style={{ fontSize: 8.5, color: 'var(--color-muted)' }}>Jess · Support worker · 3:40 PM</span>
        </div>
        <p style={{ fontSize: 9.5, lineHeight: 1.5, color: 'var(--color-ink)', margin: 0 }}>
          Lots of laughing today. Mia chose the music in art group and tried a new lunch.
        </p>
      </div>
      {/* Tonight ask */}
      <div style={{ background: '#e8f0e6', borderRadius: 10, padding: '8px 10px' }}>
        <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--color-primary-deep)', margin: '0 0 2px' }}>Tonight, ask about...</p>
        <p style={{ fontSize: 9, color: 'var(--color-primary-deep)', margin: 0 }}>— the song she picked first</p>
      </div>
    </div>
  )
}

function BehaviourScreen() {
  return (
    <div style={{ padding: '4px 12px', fontFamily: 'var(--font-ui)' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 8, background: '#faf3e6', color: 'var(--color-accent)', borderRadius: 20, padding: '2px 8px', fontFamily: 'var(--font-mono)' }}>behaviour</span>
        <span style={{ fontSize: 8, background: '#e8f0e6', color: 'var(--color-primary-deep)', borderRadius: 20, padding: '2px 8px', fontFamily: 'var(--font-mono)' }}>state</span>
      </div>
      <h3 style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 400, marginBottom: 8, lineHeight: 1.3 }}>
        Situation at lunch
      </h3>
      {(['Antecedent', 'Behaviour', 'Response'] as const).map((label, i) => (
        <div key={label} style={{ marginBottom: 6 }}>
          <p style={{ fontSize: 8, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase', margin: '0 0 2px' }}>{label}</p>
          <div style={{ background: i === 1 ? '#fdf8f0' : '#f6f2ea', borderRadius: 8, padding: '6px 8px', border: i === 1 ? '1px solid #ece4d5' : 'none' }}>
            <p style={{ fontSize: 9, color: 'var(--color-ink)', margin: 0, lineHeight: 1.4 }}>
              {i === 0 ? 'Transition from art to lunch room, unfamiliar faces at table.' :
               i === 1 ? 'Raised voice, paced near door, declined food.' :
               'Offered quiet corner, familiar playlist. Settled within 10 min.'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Check icon ───────────────────────────────────────────────────────────────

function CheckCircle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="var(--color-primary)" strokeWidth="1.5" />
      <path d="M5 8l2 2 4-4" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Landing page ─────────────────────────────────────────────────────────────

export default function Landing() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [form, setForm] = useState({ name: '', email: '', org: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email) return
    setStatus('sending')
    const { error } = await supabase.from('demo_requests').insert({
      name: form.name,
      email: form.email,
      org_name: form.org || null,
    })
    setStatus(error ? 'error' : 'done')
  }

  const plans = [
    {
      name: 'Family',
      price: null as number | null,
      cap: 'for families & guardians',
      desc: 'Stay connected to your loved one\'s care — forever free.',
      features: ['Daily digest & timeline', 'Conversation starters', 'Messaging with the team', 'Control who sees what', "A login for your loved one, if they'd like one"],
      cta: 'Get started free',
      highlight: false,
    },
    {
      name: 'Solo',
      price: billing === 'monthly' ? 29 : 24,
      cap: '3 participants',
      desc: 'Perfect for sole traders and tiny teams.',
      features: ['3 active participants', 'Unlimited workers', 'Family digest', 'Behaviour notes', 'NDIS-ready records'],
      cta: 'Start free trial',
      highlight: false,
    },
    {
      name: 'Starter',
      price: billing === 'monthly' ? 49 : 41,
      cap: '10 participants',
      desc: 'For growing providers with a proper team.',
      features: ['10 active participants', 'Unlimited workers', 'Everything in Solo', 'Shared therapy circles', 'Priority support'],
      cta: 'Start free trial',
      highlight: true,
    },
    {
      name: 'Team',
      price: billing === 'monthly' ? 7 : 6,
      cap: 'per participant / mo',
      desc: 'Scales with your caseload — no cap.',
      features: ['Unlimited participants', 'Unlimited workers', 'Everything in Starter', 'Usage billing (NDIS-ready)', 'Dedicated onboarding'],
      cta: 'Talk to us',
      highlight: false,
    },
  ]

  return (
    <div style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-ink)', background: 'var(--color-bg)' }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        height: 60,
        background: 'rgba(246,242,234,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(47,44,38,0.08)',
      }}>
        {/* Logo */}
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'var(--color-primary-deep)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13C8 13 2.5 9.5 2.5 5.5C2.5 3.5 4 2 5.5 2C6.5 2 7.5 2.7 8 3.5C8.5 2.7 9.5 2 10.5 2C12 2 13.5 3.5 13.5 5.5C13.5 9.5 8 13 8 13Z" fill="white" opacity="0.9"/>
              <path d="M6 8C6 8 4 7 4 5.5" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
            </svg>
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>Companion</span>
        </a>

        {/* Center nav links */}
        <div className="landing-nav-links">
          {['How it works', 'Features', 'Security', 'Privacy', 'Pricing'].map(label => (
            <a key={label}
              href={`#${label.toLowerCase().replace(/ /g, '-')}`}
              style={{ fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', fontWeight: 500 }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/sign-in" style={{ fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', fontWeight: 500 }}>
            Sign in
          </Link>
          <a href="#demo" style={{
            fontSize: '0.875rem',
            background: 'var(--color-primary-deep)',
            color: '#fff',
            padding: '0.5rem 1.1rem',
            borderRadius: 10,
            textDecoration: 'none',
            fontWeight: 600,
          }}>
            Book a demo
          </a>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section id="top" className="landing-hero">
        {/* Left: copy */}
        <div>
          {/* Pill badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(111,140,120,0.12)',
            border: '1px solid rgba(111,140,120,0.25)',
            borderRadius: 100,
            padding: '0.35rem 0.9rem',
            marginBottom: '1.75rem',
            fontSize: '0.825rem',
            color: 'var(--color-primary-deep)',
            fontWeight: 500,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0 }} />
            Built for NDIS providers &amp; the families they support
          </div>

          {/* Headline */}
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(2.5rem, 4.5vw, 3.75rem)',
            fontWeight: 400,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            marginBottom: '1.5rem',
            color: 'var(--color-ink)',
          }}>
            To be informed<br />
            is to <em style={{ fontStyle: 'italic', color: 'var(--color-primary)' }}>care.</em>
          </h1>

          {/* Subheadline */}
          <p style={{
            fontSize: '1.05rem',
            lineHeight: 1.7,
            color: 'var(--color-muted)',
            marginBottom: '2rem',
            maxWidth: 460,
          }}>
            Companion turns the everyday work of support into a warm daily story for families — and gives providers the calm, structured record they need. Logged in seconds. Shared with consent.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <Link to="/sign-up" style={{
              display: 'inline-block',
              background: 'var(--color-primary-deep)',
              color: '#fff',
              padding: '0.875rem 1.75rem',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.95rem',
            }}>
              Start free trial
            </Link>
            <a href="#how-it-works" style={{
              display: 'inline-block',
              background: 'transparent',
              color: 'var(--color-ink)',
              padding: '0.875rem 1.75rem',
              borderRadius: 12,
              textDecoration: 'none',
              fontWeight: 500,
              fontSize: '0.95rem',
              border: '1.5px solid rgba(47,44,38,0.2)',
            }}>
              See how it works
            </a>
          </div>

          {/* Trust micro-copy */}
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            {['Free for families, always', 'NDIS-ready records'].map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.825rem', color: 'var(--color-muted)' }}>
                <CheckCircle />
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Right: phone mockup */}
        <div className="landing-phone-col">
          <PhoneMockup screen="digest" />
        </div>
      </section>

      {/* ── Social proof bar ─────────────────────────────────────────────────── */}
      {/* ── Why Companion ────────────────────────────────────────────────────── */}
      <section id="how-it-works" style={{
        background: 'var(--color-primary-deep)',
        padding: '6rem 2rem',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: '1.5rem', fontWeight: 600 }}>
            Why Companion
          </p>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
            fontWeight: 400,
            color: '#fff',
            lineHeight: 1.2,
            marginBottom: '1.5rem',
          }}>
            Families of people with disability are too often left in the dark.
          </h2>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.75, color: 'rgba(255,255,255,0.72)', marginBottom: '2rem' }}>
            They get a brief call if they're lucky. Or a spreadsheet no one explains. Meanwhile, support workers are logging into systems built for compliance — not for the human beings they care about.
          </p>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.75, color: 'rgba(255,255,255,0.72)' }}>
            Companion closes that gap. Workers capture the day in seconds. Families receive a warm, readable story each evening. And providers get the structured records NDIS requires — automatically.
          </p>
        </div>
      </section>

      {/* ── Our story ─────────────────────────────────────────────────────────── */}
      <section id="our-story" style={{ padding: '6rem 2rem', background: 'var(--color-bg)' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '1.5rem', fontWeight: 600, textAlign: 'center' }}>
            Why I built this
          </p>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 400,
            lineHeight: 1.2, marginBottom: '1.75rem', textAlign: 'center',
          }}>
            For Sarah
          </h2>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.8, color: 'var(--color-muted)', marginBottom: '1.25rem' }}>
            Sarah is my daughter. She can't always tell us how her day went, what made her laugh, or what's bothering her — and for a long time, the only window I had into her world was a rushed handover or a short note at the end of a long shift.
          </p>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.8, color: 'var(--color-muted)', marginBottom: '1.25rem' }}>
            I wanted more than that. I wanted to actually know what happened in her day — the small, ordinary, good things as much as the hard ones. And just as importantly, I wanted Sarah herself to have a way in: her own schedule, her own timer, a place to say how she's feeling in whatever way works for her, even without words.
          </p>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.8, color: 'var(--color-muted)', marginBottom: '2rem' }}>
            Companion is built for families like ours, and for the support workers who show up for people like Sarah every day. If it helps even one more family feel closer to someone they love — and helps someone like Sarah feel more a part of the decisions being made about her own life — it's done its job.
          </p>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-ink)', textAlign: 'right' }}>
            — David, founder of Companion
          </p>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: '5rem 0' }}>

        {/* Feature 1: Daily Digest */}
        <div className="landing-feature">
          <div>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>The daily digest</p>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 400, lineHeight: 1.2, marginBottom: '1rem' }}>
              The day, told like a story — not a spreadsheet
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
              Most systems give families a cold export of timestamps. Companion writes the day as a warm, readable timeline with photos, mood, and meals — and ends with prompts to spark a real conversation that evening.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {['Conversation starters families actually use', 'Photos and mood, gathered through the day', 'Delivered automatically each evening'].map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--color-ink)' }}>
                  <CheckCircle />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="landing-phone-col">
            <PhoneMockup screen="digest" />
          </div>
        </div>

        {/* Feature 2: Behaviour Notes */}
        <div className="landing-feature">
          <div className="landing-phone-col" style={{ order: -1 }}>
            <PhoneMockup screen="behaviour" />
          </div>
          <div>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>Behaviour notes</p>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 400, lineHeight: 1.2, marginBottom: '1rem' }}>
              Structured records, written with kindness
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
              Behaviour notes follow a clear, clinical structure — what was happening, what the person did, what helped — so they're useful to therapists and respectful of the person. Capture once; share only when it matters.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {['Antecedent · behaviour · response framing', 'NDIS-ready exports for reviews & reports', 'Pattern view over weeks and months'].map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--color-ink)' }}>
                  <CheckCircle />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Feature 3: Privacy & consent */}
        <div id="privacy" className="landing-feature" style={{ marginBottom: 0 }}>
          <div>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>Privacy &amp; consent</p>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 400, lineHeight: 1.2, marginBottom: '1rem' }}>
              Shared with consent, revocable instantly
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
              Privacy is enforced at the database level — not just in the app. The decision-maker (participant or guardian) controls exactly who sees each behaviour note. One tap shares; one tap revokes.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {['Named consent — share with this therapist, not all', 'Instant revoke — takes effect immediately', 'Full access audit trail for every note'].map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--color-ink)' }}>
                  <CheckCircle />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          {/* Privacy illustration */}
          <div className="landing-phone-col">
            <div style={{
              background: '#fff',
              border: '1.5px solid rgba(47,44,38,0.08)',
              borderRadius: 24,
              padding: '2rem',
              width: 280,
              boxShadow: '0 8px 32px rgba(47,44,38,0.08)',
            }}>
              <p style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '1rem' }}>Behaviour note sharing</p>
              {[
                { name: 'Dr Anika Rao', role: 'Occupational Therapist', shared: true },
                { name: 'Physio Direct', role: 'Physiotherapy', shared: false },
                { name: 'Hartley Speech', role: 'Speech Pathology', shared: false },
              ].map(t => (
                <div key={t.name} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid #f0ebe0',
                }}>
                  <div>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>{t.name}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: 0 }}>{t.role}</p>
                  </div>
                  <div style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: t.shared ? 'var(--color-primary)' : '#e0ddd6',
                    position: 'relative',
                    cursor: 'default',
                  }}>
                    <div style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: 3,
                      left: t.shared ? 19 : 3,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </div>
                </div>
              ))}
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.75rem', textAlign: 'center' }}>
                Decision-maker controls all sharing
              </p>
            </div>
          </div>
        </div>

        {/* Feature 4: Recipient portal */}
        <div className="landing-feature" style={{ marginTop: '5rem' }}>
          <div className="landing-phone-col" style={{ order: -1 }}>
            <div style={{
              background: '#fff',
              border: '1.5px solid rgba(47,44,38,0.08)',
              borderRadius: 24,
              padding: '1.75rem',
              width: 280,
              boxShadow: '0 8px 32px rgba(47,44,38,0.08)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)', margin: 0 }}>Sarah's day</p>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-muted)', background: '#f0ebe0', borderRadius: 99, padding: '0.2rem 0.5rem' }}>🌙 Auto</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f6f2ea', borderRadius: 12, padding: '0.6rem 0.8rem', marginBottom: '0.6rem' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: `conic-gradient(var(--color-primary) 0deg 250deg, #e0ddd6 250deg 360deg)`,
                }} />
                <div>
                  <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>Speech therapy</p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>starts in 12 min</p>
                </div>
              </div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-ink)', margin: '0.9rem 0 0.5rem' }}>How are you feeling?</p>
              <div style={{ height: 8, borderRadius: 4, background: 'linear-gradient(90deg, #e8b04d, #6f8c78)', marginBottom: '0.4rem' }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '2px solid var(--color-primary-deep)', marginLeft: '68%', marginTop: -3 }} />
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-muted)', margin: '0 0 0.9rem' }}>Feeling good today</p>
              <div style={{ background: '#e8f0e6', borderRadius: 10, padding: '0.55rem 0.7rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-primary-deep)', margin: 0 }}>📌 Speech therapy moved to Thursday</p>
              </div>
            </div>
          </div>
          <div>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>For the person at the centre</p>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 400, lineHeight: 1.2, marginBottom: '1rem' }}>
              Not just a tool for the people around them
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
              The person receiving support can have their own login too — a daily schedule they can add to themselves, a countdown to whatever's next (not just a manual timer), a private space to log how they're feeling, and the notices that matter to them. Feedback the care team leaves for each other stays exactly that: private to the team, never shown to the person it's about.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {['Add and manage their own appointments alongside their circle\'s', 'A live countdown to any appointment, not just a timer they set', 'A private, self-directed mood check-in', 'Light, dark, or auto — whichever\'s easier to read', 'Never sees private team notes written about them'].map(item => (
                <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', color: 'var(--color-ink)' }}>
                  <CheckCircle />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Security & NDIS standards ────────────────────────────────────────── */}
      <section id="security" style={{ padding: '6rem 2rem', background: 'var(--color-primary-deep)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: '1rem', fontWeight: 600 }}>
            Security &amp; NDIS standards
          </p>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 400, color: '#fff', lineHeight: 1.2, marginBottom: '1.25rem' }}>
            Built to the standard NDIS providers are held to
          </h2>
          <p style={{ fontSize: '1rem', lineHeight: 1.75, color: 'rgba(255,255,255,0.72)', marginBottom: '2.5rem', maxWidth: 580, marginLeft: 'auto', marginRight: 'auto' }}>
            Client records deserve more than an app with a login screen. Companion's access rules are enforced at the database level, not just in the app — so what a support worker, family member, or coordinator can see is controlled the same way whether the request comes from the app, a script, or someone probing the API directly.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', textAlign: 'left' }}>
            {[
              { title: 'Row-level security on every table', text: 'Not an app-layer check that a future bug could skip — access control lives in the database itself, on every table that holds client data.' },
              { title: 'Australian data residency', text: 'Client data is hosted in Australia, in line with what NDIS providers need for their own records-management obligations.' },
              { title: 'Named consent, with an audit trail', text: 'Behaviour notes are shared with named individuals, not broadcast — every share and revoke is logged, and revoking takes effect immediately.' },
              { title: 'Built around the NDIS Practice Standards', text: 'Information management, privacy, and records-keeping are designed around the Practice Standards and the Australian Privacy Principles — supporting your obligations, not replacing your own policies.' },
            ].map((f) => (
              <div key={f.title} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '1.25rem 1.4rem' }}>
                <p style={{ margin: '0 0 0.4rem', fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>{f.title}</p>
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.65)' }}>{f.text}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', marginTop: '2rem' }}>
            Companion is a tool that supports your compliance work — it doesn't replace your organisation's own policies, staff training, or obligations under the NDIS Practice Standards and Code of Conduct.
          </p>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ background: 'var(--color-surface)', padding: '6rem 2rem' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>Pricing</p>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 400, marginBottom: '1rem' }}>
              Simple, transparent pricing
            </h2>
            <p style={{ fontSize: '1rem', color: 'var(--color-muted)', marginBottom: '1.75rem' }}>
              Family accounts are always free. Provider fees are NDIS-claimable.
            </p>
            {/* Toggle */}
            <div style={{
              display: 'inline-flex',
              background: '#ece4d5',
              borderRadius: 10,
              padding: 4,
              gap: 4,
            }}>
              {(['monthly', 'annual'] as const).map(b => (
                <button
                  key={b}
                  onClick={() => setBilling(b)}
                  style={{
                    padding: '0.4rem 1rem',
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    background: billing === b ? '#fff' : 'transparent',
                    color: billing === b ? 'var(--color-ink)' : 'var(--color-muted)',
                    boxShadow: billing === b ? '0 1px 4px rgba(47,44,38,0.12)' : 'none',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  {b === 'monthly' ? 'Monthly' : 'Annual — save 16%'}
                </button>
              ))}
            </div>
          </div>

          {/* Plan cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
            {plans.map(plan => (
              <div key={plan.name} style={{
                background: plan.highlight ? 'var(--color-primary-deep)' : '#fff',
                border: plan.highlight ? 'none' : '1.5px solid rgba(47,44,38,0.1)',
                borderRadius: 20,
                padding: '2rem',
                color: plan.highlight ? '#fff' : 'var(--color-ink)',
                position: 'relative',
              }}>
                {plan.highlight && (
                  <span style={{
                    position: 'absolute',
                    top: -12,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--color-accent)',
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '0.25rem 0.75rem',
                    borderRadius: 100,
                    whiteSpace: 'nowrap',
                  }}>Most popular</span>
                )}
                <p style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>{plan.name}</p>
                <p style={{ fontSize: '0.825rem', color: plan.highlight ? 'rgba(255,255,255,0.65)' : 'var(--color-muted)', marginBottom: '1rem' }}>{plan.desc}</p>
                <div style={{ marginBottom: '1.5rem' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 400 }}>
                    {plan.price === null ? 'Free' : `A$${plan.price}`}
                  </span>
                  {plan.price !== null && (
                    <span style={{ fontSize: '0.875rem', color: plan.highlight ? 'rgba(255,255,255,0.65)' : 'var(--color-muted)', marginLeft: 4 }}>
                      {plan.name === 'Team' ? '/ participant / mo' : '/ mo'}
                    </span>
                  )}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="7" cy="7" r="6" stroke={plan.highlight ? 'rgba(255,255,255,0.5)' : 'var(--color-primary)'} strokeWidth="1.2"/>
                        <path d="M4.5 7l2 2L9.5 5.5" stroke={plan.highlight ? '#fff' : 'var(--color-primary)'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ color: plan.highlight ? 'rgba(255,255,255,0.85)' : 'var(--color-ink)' }}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={plan.name === 'Team' ? '/' : plan.name === 'Family' ? '/sign-up?plan=family' : '/sign-up'}
                  onClick={plan.name === 'Team' ? (e) => { e.preventDefault(); document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }) } : undefined}
                  state={undefined}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: '0.75rem',
                    borderRadius: 10,
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    background: plan.highlight ? '#fff' : 'var(--color-primary-deep)',
                    color: plan.highlight ? 'var(--color-primary-deep)' : '#fff',
                  }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
            Family plan is free forever. Provider plans include a 14-day free trial — no credit card required. GST invoices included.{' '}
            <Link to="/deck" style={{ color: 'var(--color-primary-deep)', textDecoration: 'none' }}>Investor information →</Link>
          </p>
        </div>
      </section>

      {/* ── Demo form ─────────────────────────────────────────────────────────── */}
      <section id="demo" style={{ padding: '6rem 2rem', background: 'var(--color-bg)' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '0.75rem', fontWeight: 600 }}>Book a demo</p>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 400, marginBottom: '0.75rem', lineHeight: 1.2 }}>
            See Companion in action
          </h2>
          <p style={{ fontSize: '1rem', color: 'var(--color-muted)', marginBottom: '2.5rem', lineHeight: 1.7 }}>
            We'll walk you through the daily digest, behaviour notes, and consent model — 30 minutes, no pressure.
          </p>

          {status === 'done' ? (
            <div style={{
              background: '#e8f0e6',
              border: '1.5px solid rgba(111,140,120,0.3)',
              borderRadius: 16,
              padding: '2rem',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🌿</div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, marginBottom: '0.5rem' }}>You're on the list</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>We'll be in touch within one business day.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', textAlign: 'left' }}>
              {[
                { key: 'name', label: 'Your name', placeholder: 'Jane Smith', type: 'text', required: true },
                { key: 'email', label: 'Work email', placeholder: 'jane@provider.com.au', type: 'email', required: true },
                { key: 'org', label: 'Organisation (optional)', placeholder: 'Riverside Care', type: 'text', required: false },
              ].map(field => (
                <div key={field.key}>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-ink)' }}>
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    placeholder={field.placeholder}
                    value={form[field.key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    required={field.required}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: 10,
                      border: '1.5px solid rgba(47,44,38,0.15)',
                      background: '#fff',
                      fontSize: '0.95rem',
                      fontFamily: 'var(--font-ui)',
                      color: 'var(--color-ink)',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
              {status === 'error' && (
                <p style={{ fontSize: '0.875rem', color: '#c0392b' }}>
                  Something went wrong — please email us at <a href="mailto:hello@companion.care">hello@companion.care</a>
                </p>
              )}
              <button
                type="submit"
                disabled={status === 'sending'}
                style={{
                  background: 'var(--color-primary-deep)',
                  color: '#fff',
                  border: 'none',
                  padding: '0.875rem',
                  borderRadius: 12,
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: status === 'sending' ? 'default' : 'pointer',
                  opacity: status === 'sending' ? 0.7 : 1,
                  fontFamily: 'var(--font-ui)',
                  marginTop: '0.25rem',
                }}
              >
                {status === 'sending' ? 'Sending...' : 'Request a demo'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid rgba(47,44,38,0.1)',
        padding: '3rem 2rem',
      }}>
        <div className="landing-footer-grid">
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--color-primary-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13C8 13 2.5 9.5 2.5 5.5C2.5 3.5 4 2 5.5 2C6.5 2 7.5 2.7 8 3.5C8.5 2.7 9.5 2 10.5 2C12 2 13.5 3.5 13.5 5.5C13.5 9.5 8 13 8 13Z" fill="white" opacity="0.9"/>
                </svg>
              </div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1rem' }}>Companion</span>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6, maxWidth: 240 }}>
              Care coordination for NDIS providers and the families they serve.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '1.5rem' }}>
              © 2026 Companion. AU data residency.<br />ABN available on request.
            </p>
          </div>

          {/* Product links */}
          <div>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600, marginBottom: '0.75rem' }}>Product</p>
            {[['How it works', '#how-it-works'], ['Features', '#features'], ['Security', '#security'], ['Privacy', '#privacy'], ['Pricing', '#pricing']].map(([l, h]) => (
              <a key={l} href={h} style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>{l}</a>
            ))}
          </div>

          {/* Company links */}
          <div>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600, marginBottom: '0.75rem' }}>Company</p>
            <a href="#our-story" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>Our story</a>
            <a href="#demo" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>Book a demo</a>
            <Link to="/deck" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>Investor information</Link>
            <Link to="/sign-in" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>Sign in</Link>
            <Link to="/sign-up" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none' }}>Sign up</Link>
          </div>

          {/* Contact */}
          <div>
            <p style={{ fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600, marginBottom: '0.75rem' }}>Contact</p>
            <a href="mailto:hello@companion.care" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none', marginBottom: '0.4rem' }}>hello@companion.care</a>
            <a href="mailto:david@theservicemanager.com" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--color-muted)', textDecoration: 'none' }}>david@theservicemanager.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
