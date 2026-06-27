import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const MAB_EMBED_SRC = 'https://myappbuddy.com.au/embed/v1.js'

function loadMabEmbed() {
  if (document.getElementById('mab-embed')) return
  const s = document.createElement('script')
  s.id = 'mab-embed'
  s.src = MAB_EMBED_SRC
  document.head.appendChild(s)
}

export default function Feedback() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [embedHeight, setEmbedHeight] = useState('500px')

  useEffect(() => {
    loadMabEmbed()
    function updateHeight() {
      if (containerRef.current) {
        setEmbedHeight(`${containerRef.current.clientHeight}px`)
      }
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', flexShrink: 0,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Feedback &amp; support</h1>
      </div>

      {/* MAB support embed — scoped to Companion */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        {React.createElement('myappbuddy-support', {
          mode: 'embed',
          app: 'companion',
          height: embedHeight,
          style: { display: 'block', height: '100%' },
        })}
      </div>
    </div>
  )
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'myappbuddy-support': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        mode?: string
        app?: string
        height?: string
      }
    }
  }
}
