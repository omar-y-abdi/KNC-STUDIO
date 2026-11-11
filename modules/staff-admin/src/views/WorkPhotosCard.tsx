// The Profil tab's "Jobbilder" card: pictures of the barber's work for the public cuts gallery.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import { barberWorkUrl } from '../adapters/barberPhotoAdmin'
import { orderedProfileOperation, type BarberProfilePort } from '../adapters/barberProfile'
import { adminText } from '../adminStrings'
import { ConfirmDialog } from '../ConfirmDialog'
import type { BarberWorkPhoto } from '../types'
import {
  focusAfterRemoval,
  withHidden,
  withoutWork,
  withUploaded,
  workUploadingLabel,
} from './profileForm'
import type { AdminBarberId, AdminStylesBundle } from './viewTypes'

export interface WorkPhotosCardProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
  readonly isOwner: boolean
  readonly initial: readonly BarberWorkPhoto[]
  readonly port: BarberProfilePort
}

type WorkError = 'workUploadError' | 'workRemoveError' | 'workHideError'
/** A picture's id, or the upload button. */
type FocusTarget = string | 'upload'

const HEADING_ID = 'profile-work-heading'

export function WorkPhotosCard(props: WorkPhotosCardProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [work, setWork] = useState<readonly BarberWorkPhoto[]>(props.initial)
  const [uploading, setUploading] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<WorkError | null>(null)
  const [hiding, setHiding] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<BarberWorkPhoto | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const latestWork = useRef(work)
  latestWork.current = work
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLButtonElement>(null)
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  const scope = useRef(0)

  useEffect(
    () => () => {
      scope.current += 1
    },
    [],
  )

  // Passive, so it runs after the confirm dialog's own focus restore on close.
  useEffect(() => {
    if (focusTarget === null) return
    const target =
      focusTarget === 'upload' ? uploadRef.current : removeButtons.current.get(focusTarget)
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  const upload = async (files: readonly File[]): Promise<void> => {
    const generation = scope.current
    setError(null)
    for (const [index, file] of files.entries()) {
      setUploading({ current: index + 1, total: files.length })
      const result = await orderedProfileOperation(props.barberId, () =>
        props.port.uploadWork(props.barberId, file),
      )
      if (scope.current !== generation) return
      if (!result.ok) {
        setError('workUploadError')
        break
      }
      setWork((current) => withUploaded(current, result.value))
    }
    setUploading(null)
  }

  const toggleHidden = async (photo: BarberWorkPhoto): Promise<void> => {
    const generation = scope.current
    setError(null)
    setHiding(photo.id)
    const result = await orderedProfileOperation(props.barberId, () =>
      props.port.setWorkHidden(photo.id, !photo.hidden),
    )
    if (scope.current !== generation) return
    setHiding(null)
    if (result.ok) setWork((current) => withHidden(current, photo.id, !photo.hidden))
    else setError('workHideError')
  }

  const remove = async (): Promise<void> => {
    if (pendingRemove === null) return
    const photo = pendingRemove
    const generation = scope.current
    setError(null)
    setRemoveBusy(true)
    const result = await orderedProfileOperation(props.barberId, () =>
      props.port.removeWork(props.barberId, photo.path),
    )
    if (scope.current !== generation) return
    setRemoveBusy(false)
    setPendingRemove(null)
    if (!result.ok) {
      setError('workRemoveError')
      return
    }
    setFocusTarget(focusAfterRemoval(latestWork.current, photo.id) ?? 'upload')
    setWork((current) => withoutWork(current, photo.id))
  }

  const busyUploading = uploading !== null
  const smallButton = (base: JSX.CSSProperties, disabled: boolean): JSX.CSSProperties => ({
    ...base,
    padding: '9px 10px',
    fontSize: '13px',
    minHeight: '36px',
    opacity: disabled ? 0.6 : 1,
  })

  return (
    <section style={s.card} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} style={s.sectionTitle}>
        {t.workTitle} · {props.barberName}
      </h2>
      <p style={s.sectionLead}>{t.workLead}</p>

      <button
        ref={uploadRef}
        type="button"
        data-tour="profile-work"
        disabled={busyUploading}
        onClick={() => fileRef.current?.click()}
        style={{
          ...s.primaryBtn,
          marginTop: '12px',
          opacity: busyUploading ? 0.6 : 1,
          cursor: busyUploading ? 'default' : 'pointer',
        }}
      >
        {uploading === null
          ? t.workUpload
          : workUploadingLabel(t.workUploading, uploading.current, uploading.total)}
      </button>
      <input
        ref={fileRef}
        id="profile-work-input"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
        disabled={busyUploading}
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length > 0) void upload(files)
        }}
      />
      {error !== null ? (
        <p role="alert" style={{ ...s.errorText, margin: '10px 0 0' }}>
          {t[error]}
        </p>
      ) : null}

      {work.length === 0 ? (
        <div style={s.emptyState}>{t.workEmpty}</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            gap: '12px',
            marginTop: '16px',
          }}
        >
          {work.map((photo) => {
            const busy = hiding === photo.id
            return (
              <div key={photo.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  style={{
                    position: 'relative',
                    aspectRatio: '4 / 3',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: s.card.border,
                  }}
                >
                  <img
                    src={barberWorkUrl(photo.path)}
                    alt=""
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                      opacity: photo.hidden ? 0.45 : 1,
                    }}
                  />
                  {photo.hidden ? (
                    <span
                      style={{
                        ...s.pill,
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        background: s.card.background,
                      }}
                    >
                      {t.workHiddenTag}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {props.isOwner ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleHidden(photo)}
                      style={smallButton(s.ghostBtn, busy)}
                    >
                      {photo.hidden ? t.workShow : t.reviewsHide}
                    </button>
                  ) : null}
                  <button
                    ref={(button) => {
                      if (button === null) removeButtons.current.delete(photo.id)
                      else removeButtons.current.set(photo.id, button)
                    }}
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingRemove(photo)}
                    style={smallButton(s.dangerBtn, busy)}
                  >
                    {t.scheduleTimeOffRemove}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pendingRemove !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.workRemoveTitle}
          body={t.workRemoveBody}
          confirmLabel={t.scheduleTimeOffRemove}
          cancelLabel={t.svcDeleteCancel}
          danger
          busy={removeBusy}
          onConfirm={() => void remove()}
          onClose={() => {
            if (!removeBusy) setPendingRemove(null)
          }}
        />
      ) : null}
    </section>
  )
}
