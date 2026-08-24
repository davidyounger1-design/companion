import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'
import { BSP_BUCKET } from '../lib/behaviourSupportPlans'

function fileExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
}

export default function BehaviourSupportPlanForm({
  clientId,
  orgId,
  authorId,
  onSaved,
  onCancel,
}: {
  clientId: string
  orgId: string
  authorId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [reviewDue, setReviewDue] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      if (!file) return
      // Upload idiom mirrors the journal-photo flow (see CoordinatorClientDetail
      // addLog): a UUID-named object in a private bucket, with the object key
      // stored on the row. Documents are NOT encrypted/thumbnailed like photos —
      // the bsp-documents bucket pipeline deliberately skips 018/061.
      const ext = fileExt(file)
      const fileUuid = crypto.randomUUID()
      const filePath = `${orgId}/${clientId}/${authorId}/${fileUuid}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from(BSP_BUCKET)
        .upload(filePath, file, { upsert: false })
      if (uploadErr) throw uploadErr

      const { error: insertErr } = await supabase.from('behaviour_support_plans').insert({
        org_id: orgId,
        client_id: clientId,
        uploaded_by: authorId,
        file_path: filePath,
        file_name: file.name,
        review_due: reviewDue || null,
      })
      if (insertErr) {
        // Best-effort cleanup so a failed row insert never orphans the object
        // (e.g. the 087 table hasn't landed while the bucket already exists).
        await supabase.storage.from(BSP_BUCKET).remove([filePath]).catch(() => {})
        throw insertErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['behaviour-support-plans', clientId] })
      // Keep the restrictive-practices form's BSP selector fresh too, if open.
      qc.invalidateQueries({ queryKey: ['client-bsp-plans', clientId] })
      onSaved()
    },
  })

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>Upload a behaviour support plan</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!file) return
          save.mutate()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="field">
          <label htmlFor="bsp-file">Document</label>
          <input
            id="bsp-file"
            type="file"
            className="input"
            accept=".pdf,.doc,.docx,.rtf,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
              {file.name} ({Math.round(file.size / 1024)} KB)
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="bsp-review-due">
            Review due <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="bsp-review-due" type="date" className="input" value={reviewDue}
            onChange={(e) => setReviewDue(e.target.value)} />
        </div>

        {save.isError && (
          <div className="alert alert-error">
            {errorMessage(save.error, 'Upload failed. Try again.')}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !file} style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : 'Upload plan'}
          </button>
        </div>
      </form>
    </div>
  )
}
