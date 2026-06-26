import { useEffect } from 'react'

function isVideo(src: string) {
  return /\.(mp4|mov|webm|m4v|avi|ogv)(\?|$)/i.test(src)
}

export default function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', cursor: 'zoom-out',
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)',
          border: 'none', color: '#fff', borderRadius: '50%', width: 36, height: 36,
          fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>
      {isVideo(src) ? (
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
          style={{ maxWidth: '100%', maxHeight: '90dvh', borderRadius: 8, objectFit: 'contain' }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
}
