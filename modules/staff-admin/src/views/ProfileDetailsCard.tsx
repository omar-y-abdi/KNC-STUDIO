// The Profil tab's "Uppgifter" card: the barber's name, handles and bios, public on save.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import { orderedProfileOperation, type BarberProfilePort } from '../adapters/barberProfile'
import { adminText } from '../adminStrings'
import type { BarberProfileDetails, ProfileSaveFailure } from '../types'
import {
  BIO_MAX,
  bioCounter,
  HANDLE_MAX,
  isDirty,
  NAME_MAX,
  saveFailureString,
} from './profileForm'
import type { AdminBarberId, AdminStylesBundle } from './viewTypes'

export interface ProfileDetailsCardProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
  readonly initial: BarberProfileDetails
  readonly port: BarberProfilePort
  /** After a save that changed the name. */
  readonly onNameSaved: () => void
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly failure: ProfileSaveFailure }

const HEADING_ID = 'profile-details-heading'

export function ProfileDetailsCard(props: ProfileDetailsCardProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [loaded, setLoaded] = useState<BarberProfileDetails>(props.initial)
  const [form, setForm] = useState<BarberProfileDetails>(props.initial)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  // Two submits in one turn both see the old render's `saving`.
  const inFlight = useRef(false)
  const scope = useRef(0)

  useEffect(
    () => () => {
      scope.current += 1
    },
    [],
  )

  const saving = save.kind === 'saving'
  const dirty = isDirty(loaded, form)

  const edit = (patch: Partial<BarberProfileDetails>): void => {
    setForm((current) => ({ ...current, ...patch }))
    if (!saving) setSave({ kind: 'idle' })
  }

  const submit = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (inFlight.current || !dirty) return
    inFlight.current = true
    const generation = scope.current
    const before = loaded
    const details = form
    setSave({ kind: 'saving' })
    const result = await orderedProfileOperation(props.barberId, () =>
      props.port.save(props.barberId, details),
    )
    if (scope.current !== generation) return
    inFlight.current = false
    if (!result.ok) {
      setSave({ kind: 'failed', failure: result.error })
      return
    }
    setLoaded(result.value)
    setForm(result.value)
    setSave({ kind: 'saved' })
    if (result.value.name !== before.name) props.onNameSaved()
  }

  const counterStyle: JSX.CSSProperties = {
    ...s.mutedText,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  }
  const handleInput = (
    id: string,
    label: string,
    value: string,
    onValue: (value: string) => void,
  ): JSX.Element => (
    <div style={s.fieldRow}>
      <label htmlFor={id} style={s.label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        maxLength={HANDLE_MAX}
        placeholder={t.profileHandlePlaceholder}
        autocapitalize="none"
        autocorrect="off"
        spellcheck={false}
        value={value}
        disabled={saving}
        onInput={(event) => onValue(event.currentTarget.value)}
        style={s.input}
      />
    </div>
  )
  const submitDisabled = saving || !dirty

  return (
    <section style={s.card} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} style={s.sectionTitle}>
        {t.profileDetailsTitle} · {props.barberName}
      </h2>
      <p style={s.sectionLead}>{t.profileDetailsLead}</p>

      <form
        onSubmit={submit}
        noValidate
        aria-labelledby={HEADING_ID}
        style={{ maxWidth: '560px', marginTop: '22px' }}
      >
        <div data-tour="profile-details" style={s.fieldRow}>
          <label htmlFor="profile-details-name" style={s.label}>
            {t.barbersFieldName}
          </label>
          <input
            id="profile-details-name"
            type="text"
            maxLength={NAME_MAX}
            required
            value={form.name}
            disabled={saving}
            onInput={(event) => edit({ name: event.currentTarget.value })}
            style={s.input}
          />
        </div>
        {handleInput('profile-details-ig', t.barbersFieldInstagram, form.ig, (ig) => edit({ ig }))}
        {handleInput('profile-details-tiktok', t.profileTiktokLabel, form.tiktok, (tiktok) =>
          edit({ tiktok }),
        )}
        <div style={s.fieldRow}>
          <label htmlFor="profile-details-bio-sv" style={s.label}>
            {t.profileBioSvLabel}
          </label>
          <textarea
            id="profile-details-bio-sv"
            rows={4}
            maxLength={BIO_MAX}
            aria-describedby="profile-details-bio-sv-count"
            value={form.bioSv}
            disabled={saving}
            onInput={(event) => edit({ bioSv: event.currentTarget.value })}
            style={s.textarea}
          />
          <div id="profile-details-bio-sv-count" style={counterStyle}>
            {bioCounter(form.bioSv)}
          </div>
        </div>
        <div style={s.fieldRow}>
          <label htmlFor="profile-details-bio-en" style={s.label}>
            {t.profileBioEnLabel}
          </label>
          <p id="profile-details-bio-en-hint" style={{ ...s.mutedText, margin: '0 0 6px' }}>
            {t.profileBioEnHint}
          </p>
          <textarea
            id="profile-details-bio-en"
            rows={4}
            maxLength={BIO_MAX}
            aria-describedby="profile-details-bio-en-hint profile-details-bio-en-count"
            value={form.bioEn}
            disabled={saving}
            onInput={(event) => edit({ bioEn: event.currentTarget.value })}
            style={s.textarea}
          />
          <div id="profile-details-bio-en-count" style={counterStyle}>
            {bioCounter(form.bioEn)}
          </div>
        </div>

        <div aria-live="polite" style={{ minHeight: '20px', marginBottom: '10px' }}>
          {save.kind === 'failed' ? (
            <span role="alert" style={s.errorText}>
              {t[saveFailureString(save.failure)]}
            </span>
          ) : null}
          {save.kind === 'saved' ? (
            <span role="status" style={s.successText}>
              {t.profileDetailsSaved}
            </span>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={submitDisabled}
          style={{
            ...s.primaryBtn,
            opacity: submitDisabled ? 0.6 : 1,
            cursor: submitDisabled ? 'default' : 'pointer',
          }}
        >
          {saving ? t.barbersSaving : t.barbersSave}
        </button>
      </form>
    </section>
  )
}
