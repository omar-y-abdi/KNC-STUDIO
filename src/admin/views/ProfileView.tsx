// Profil view — a barber's profile photo (Task 2 §3). Acts on the effective barber (the owner's
// selected barber, or the signed-in barber themselves), so it serves both roles from one surface:
// the owner sets any barber's photo, a barber sets their own. Upload replaces the previous photo;
// remove clears it. RLS is the hard backstop. Data effects live here; the render is otherwise pure.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { getBarberPhoto, removeBarberPhoto, uploadBarberPhoto } from '../adapters/barberPhotoAdmin'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AdminBarberId, AdminStylesBundle } from './viewTypes'

export interface ProfileViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
}

export function ProfileView(props: ProfileViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)

  const [storagePath, setStoragePath] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setNotice(null)
    void getBarberPhoto(props.barberId).then((r) => {
      if (!active) return
      if (r.ok) {
        setStoragePath(r.value?.storagePath ?? null)
        setUrl(r.value?.url ?? null)
      } else {
        setNotice({ kind: 'err', text: r.error.message })
      }
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [props.barberId])

  const onUpload = async (file: File): Promise<void> => {
    setBusy(true)
    setNotice(null)
    const r = await uploadBarberPhoto(props.barberId, file)
    setBusy(false)
    if (fileRef.current !== null) fileRef.current.value = ''
    if (!r.ok) {
      setNotice({ kind: 'err', text: r.error.message })
      return
    }
    setStoragePath(r.value.storagePath)
    setUrl(r.value.url)
    setNotice({ kind: 'ok', text: t.profileUploadedOk })
  }

  const onDelete = async (): Promise<void> => {
    if (storagePath === null) return
    setDeleteBusy(true)
    const r = await removeBarberPhoto(props.barberId, storagePath)
    setDeleteBusy(false)
    setPendingDelete(false)
    if (!r.ok) {
      setNotice({ kind: 'err', text: r.error.message })
      return
    }
    setStoragePath(null)
    setUrl(null)
    setNotice({
      kind: 'ok',
      text: r.value.pending ? t.profileRemovalPending : t.profileRemovedOk,
    })
  }

  return (
    <section style={s.card} aria-labelledby="profile-heading">
      <h2 id="profile-heading" style={s.sectionTitle}>
        {t.profileTitle} · {props.barberName}
      </h2>
      <p style={s.sectionLead}>{t.profileLead}</p>

      {!loaded ? (
        <div style={s.emptyState}>{t.profileLoading}</div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            gap: '20px',
            marginTop: '12px',
          }}
        >
          <div
            style={{
              width: '160px',
              height: '160px',
              flex: 'none',
              borderRadius: '16px',
              overflow: 'hidden',
              border: s.card.border,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: s.emptyState.background,
            }}
          >
            {url !== null ? (
              <img
                src={url}
                alt={t.profilePhotoAlt}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span
                style={{ ...s.mutedText, fontSize: '13px', textAlign: 'center', padding: '12px' }}
              >
                {t.profileNoPhoto}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 200px' }}>
            <label
              style={{
                ...s.primaryBtn,
                textAlign: 'center',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? t.profileUploading : url !== null ? t.profileReplace : t.profileUpload}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={busy}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (file !== undefined) void onUpload(file)
                }}
              />
            </label>
            {url !== null ? (
              <button
                type="button"
                style={s.dangerBtn}
                disabled={busy}
                onClick={() => setPendingDelete(true)}
              >
                {t.profileRemove}
              </button>
            ) : null}
            <div aria-live="polite" style={{ minHeight: '18px' }}>
              {notice !== null ? (
                <span style={notice.kind === 'ok' ? s.successText : s.errorText}>
                  {notice.text}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.profileDeleteTitle}
          body={t.profileDeleteBody}
          confirmLabel={t.profileRemove}
          cancelLabel={t.svcDeleteCancel}
          danger
          busy={deleteBusy}
          onConfirm={() => void onDelete()}
          onClose={() => {
            if (!deleteBusy) setPendingDelete(false)
          }}
        />
      ) : null}
    </section>
  )
}
