import { useState } from 'react'
import { useModalOpen } from '../context/ModalActivityContext'
import SegmentedControl from './SegmentedControl'

export type PrintRange = 'today' | 'week' | 'next7'

/** Bottom-sheet prompt for the schedule Print button: which days to include,
 * and whether to show each item's time (some households print a plain
 * checklist to stick on the fridge and don't want clock times on it). */
export default function PrintScheduleModal({
  onClose, onPrint,
}: {
  onClose: () => void
  onPrint: (range: PrintRange, showTime: boolean) => void | Promise<void>
}) {
  useModalOpen()
  const [range, setRange] = useState<PrintRange>('today')
  const [showTime, setShowTime] = useState(true)
  const [printing, setPrinting] = useState(false)

  async function handlePrint() {
    setPrinting(true)
    try {
      await onPrint(range, showTime)
      onClose()
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 480, margin: '0 auto',
        padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>
        <p style={{ margin: '0 0 1rem', fontWeight: 700, fontSize: '1.05rem' }}>Print schedule</p>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label>Date range</label>
          <SegmentedControl
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
              { value: 'next7', label: 'Next 7 days' },
            ]}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', fontSize: '0.9rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} />
          Include times
        </label>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handlePrint} disabled={printing} style={{ flex: 2 }}>
            {printing ? <span className="spinner" /> : '🖨️ Print'}
          </button>
        </div>
      </div>
    </>
  )
}
