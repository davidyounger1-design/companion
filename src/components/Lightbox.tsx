import { useEffect, useState } from 'react'

function isVideo(src: string) {
  return /\.(mp4|mov|webm|m4v|avi|ogv)(\?|$)/i.test(src)
}

async function shareMedia(src: string, text?: string) {
  try {
    const res  = await fetch(src)
    const blob = await res.blob()
    const ext  = blob.type.split('/')[1]?.split('+')[0] || 'jpg'
    const file = new File([blob], `companion-photo.${ext}`, { type: blob.type })
    const extra = text ? { text } : {}

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Photo from Companion', ...extra })
    } else if (navigator.share) {
      await navigator.share({ url: src, title: 'Photo from Companion', ...extra })
    }
  } catch {
    // User cancelled or browser doesn't support share
  }
}

export default function Lightbox({
  src,
  onClose,
  canShare = false,
  video: forceVideo,
  shareText,
}: {
  src: string
  onClose: () => void
  canShare?: boolean
  video?: boolean
  shareText?: string
}) {
  const [sharing, setSharing] = useState(false)
  const video = forceVideo ?? isVideo(src)
  const supportsShare = typeof navigator !== 'undefined' && !!navigator.share

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    setSharing(true)
    await shareMedia(src, shareText)
    setSharing(false)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        cursor: 'zoom-out',
      }}
    >
      {/* Top-right controls */}
      <div style={{
        position: 'absolute', top: 16, right: 16,
        display: 'flex', gap: 8,
      }}>
        {canShare && !video && supportsShare && (
          <button
            onClick={handleShare}
            disabled={sharing}
            title="Share photo"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none', color: '#fff',
              borderRadius: '50%', width: 40, height: 40,
              fontSize: '1.1rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: sharing ? 0.5 : 1,
              transition: 'opacity .15s',
            }}
          >
            {sharing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ animation: 'spin .65s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          title="Close"
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none', color: '#fff',
            borderRadius: '50%', width: 40, height: 40,
            fontSize: '1.1rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
      </div>

      {video ? (
        <video
          src={src}
          controls
          autoPlay
          style={{ maxWidth: '100%', maxHeight: '90dvh', borderRadius: 8 }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={src}
          alt=""
          style={{
            maxWidth: '100%', maxHeight: '90dvh',
            borderRadius: 8, objectFit: 'contain',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
}
