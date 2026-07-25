import { useEffect, useState, useCallback } from 'react'

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
  srcs,
  initialIndex = 0,
  onClose,
  canShare = false,
  video: forceVideo,
  shareText,
}: {
  /** Single source — legacy API, still supported. */
  src?: string
  /** Multiple sources — gallery mode. Takes precedence over `src` when both provided. */
  srcs?: string[]
  initialIndex?: number
  onClose: () => void
  canShare?: boolean
  video?: boolean
  shareText?: string
}) {
  const all = srcs && srcs.length > 0 ? srcs : src ? [src] : []
  const [index, setIndex] = useState(initialIndex)
  const currentSrc = all[index] ?? ''
  const [sharing, setSharing] = useState(false)
  const video = forceVideo ?? isVideo(currentSrc)
  const supportsShare = typeof navigator !== 'undefined' && !!navigator.share
  const hasGallery = all.length > 1

  const goPrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIndex((i) => (i - 1 + all.length) % all.length)
  }, [all.length])

  const goNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIndex((i) => (i + 1) % all.length)
  }, [all.length])

  useEffect(() => {
    setIndex(initialIndex)
  }, [initialIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, goPrev, goNext])

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation()
    setSharing(true)
    await shareMedia(currentSrc, shareText)
    setSharing(false)
  }

  if (all.length === 0) return null

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
        display: 'flex', gap: 8, zIndex: 1,
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

      {/* Gallery nav arrows */}
      {hasGallery && (
        <>
          <button
            onClick={goPrev}
            title="Previous"
            style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
              borderRadius: '50%', width: 44, height: 44, fontSize: '1.3rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1,
            }}
          >‹</button>
          <button
            onClick={goNext}
            title="Next"
            style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
              borderRadius: '50%', width: 44, height: 44, fontSize: '1.3rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1,
            }}
          >›</button>
        </>
      )}

      {/* Counter */}
      {hasGallery && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '0.8rem',
          padding: '0.25rem 0.75rem', borderRadius: 99,
        }}>
          {index + 1} of {all.length}
        </div>
      )}

      {/* Media */}
      {video ? (
        <video
          key={currentSrc}
          src={currentSrc}
          controls
          autoPlay
          style={{ maxWidth: '100%', maxHeight: '90dvh', borderRadius: 8 }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          key={currentSrc}
          src={currentSrc}
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
