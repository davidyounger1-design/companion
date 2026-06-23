import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../context/AuthContext'
import { createOrganisation } from '../../lib/auth'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

const SERVICE_OPTIONS = [
  'Support Coordination',
  'Supported Independent Living (SIL)',
  'Community Access',
  'Daily Activities',
  'Behaviour Support',
  'Allied Health',
  'Early Childhood',
  'Plan Management',
]

const schema = z.object({
  orgName: z.string().min(2, 'Organisation name is required'),
  abn: z.string().optional(),
  state: z.string().min(1, 'Please select your state'),
})

type FormData = z.infer<typeof schema>

export default function Step1Service() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { state: '' },
  })

  function toggleService(s: string) {
    setSelectedServices((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  async function onSubmit(data: FormData) {
    if (!user) return
    setServerError('')
    try {
      await createOrganisation(user.id, data.orgName, data.state, selectedServices)
      navigate('/setup/plan')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save. Please try again.')
    }
  }

  // Already has org — go straight to next step
  if (profile?.org_id) {
    navigate('/setup/plan')
    return null
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        About your service
      </h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Tell us about your organisation so we can set things up correctly.
      </p>

      {serverError && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="field">
          <label htmlFor="orgName">Organisation name</label>
          <input
            id="orgName"
            className={`input${errors.orgName ? ' error' : ''}`}
            placeholder="Sunrise Support Services"
            {...register('orgName')}
          />
          {errors.orgName && <span className="field-error">{errors.orgName.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="abn">ABN <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span></label>
          <input
            id="abn"
            className="input"
            placeholder="12 345 678 901"
            {...register('abn')}
          />
        </div>

        <div className="field">
          <label htmlFor="state">State / territory</label>
          <select
            id="state"
            className={`input${errors.state ? ' error' : ''}`}
            {...register('state')}
          >
            <option value="">Select state…</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors.state && <span className="field-error">{errors.state.message}</span>}
        </div>

        <div className="field">
          <label>Services you deliver <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(select all that apply)</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.25rem' }}>
            {SERVICE_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleService(s)}
                style={{
                  padding: '0.4rem 0.85rem',
                  borderRadius: 99,
                  border: '1.5px solid',
                  borderColor: selectedServices.includes(s) ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 35%, transparent)',
                  background: selectedServices.includes(s) ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'transparent',
                  color: selectedServices.includes(s) ? 'var(--color-primary-deep)' : 'var(--color-muted)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-full"
          disabled={isSubmitting}
          style={{ marginTop: '0.5rem' }}
        >
          {isSubmitting ? <span className="spinner" /> : 'Save & continue →'}
        </button>
      </form>
    </div>
  )
}
