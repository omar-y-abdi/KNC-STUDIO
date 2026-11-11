// Profil view — a barber's profile photo (Task 2 §3). Acts on the effective barber (the owner's
// selected barber, or the signed-in barber themselves), so it serves both roles from one surface:
// the owner sets any barber's photo, a barber sets their own. Upload replaces the previous photo;
// remove clears it. RLS is the hard backstop. Data effects live here; the render is otherwise pure.

import type { JSX } from 'preact'
import { orderedAdminOperation } from '../orderedOperations'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '@bladeblend/public-web/localization'
import { adminText } from '../adminStrings'
import { INVISIBLE } from '../adminStyles'
import { getBarberPhoto, removeBarberPhoto, uploadBarberPhoto } from '../adapters/barberPhotoAdmin'
import {
  barberProfilePort,
  orderedProfileOperation,
  type BarberProfilePort,
} from '../adapters/barberProfile'
import { ConfirmDialog } from '../ConfirmDialog'
import type { BarberSelfProfile } from '../types'
import { ProfileDetailsCard } from './ProfileDetailsCard'
import type { AdminBarberId, AdminStylesBundle } from './viewTypes'
import { WorkPhotosCard } from './WorkPhotosCard'

export interface ProfileViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
  readonly isOwner: boolean
  /** After a saved name, so the headings, the greeting and the owner's selector show it. */
  readonly onRosterChanged: () => void
  readonly port?: ProfileViewPort
  readonly profilePort?: BarberProfilePort
}

const defaultProfilePort = { getBarberPhoto, removeBarberPhoto, uploadBarberPhoto }
export type ProfileViewPort = typeof defaultProfilePort

export function ProfileView(props: ProfileViewProps): JSX.Element {
  const { s, lang } = props
  const port = props.port ?? defaultProfilePort
  const resource = `photo:${props.barberId}`
  const t = adminText(lang)

  const [storagePath, setStoragePath] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadedGeneration, setLoadedGeneration] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const barberScope = useRef({ id: props.barberId, generation: 0 })
  if (barberScope.current.id !== props.barberId) {
    barberScope.current = {
      id: props.barberId,
      generation: barberScope.current.generation + 1,
    }
  }

  useEffect(
    () => () => {
      barberScope.current = {
        id: barberScope.current.id,
        generation: barberScope.current.generation + 1,
      }
    },
    [],
  )

  useEffect(() => {
    let active = true
    const barberGeneration = barberScope.current.generation
    setLoaded(false)
    setLoadedGeneration(null)
    setStoragePath(null)
    setUrl(null)
    setNotice(null)
    setBusy(false)
    setPendingDelete(false)
    setDeleteBusy(false)
    if (fileRef.current !== null) fileRef.current.value = ''
    void orderedAdminOperation(resource, () => port.getBarberPhoto(props.barberId)).then((r) => {
      if (!active) return
      if (r.ok) {
        setStoragePath(r.value?.storagePath ?? null)
        setUrl(r.value?.url ?? null)
      } else {
        setNotice({ kind: 'err', text: r.error.message })
      }
      setLoadedGeneration(barberGeneration)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [props.barberId, port])

  const onUpload = async (file: File): Promise<void> => {
    const barberId = props.barberId
    const barberGeneration = barberScope.current.generation
    setBusy(true)
    setNotice(null)
    const r = await orderedAdminOperation(resource, () => port.uploadBarberPhoto(barberId, file))
    if (barberScope.current.generation !== barberGeneration) return
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
    const barberId = props.barberId
    const barberGeneration = barberScope.current.generation
    setDeleteBusy(true)
    const r = await orderedAdminOperation(resource, () =>
      port.removeBarberPhoto(barberId, storagePath),
    )
    if (barberScope.current.generation !== barberGeneration) return
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

  const mutationBusy = busy || deleteBusy
  const targetLoaded = loaded && loadedGeneration === barberScope.current.generation

  const photoCard = (
    <section style={s.card} aria-labelledby="profile-heading">
      <h2 id="profile-heading" style={s.sectionTitle}>
        {t.profileTitle} · {props.barberName}
      </h2>
      <p style={s.sectionLead}>{t.profileLead}</p>

      {!targetLoaded ? (
        <div style={{ ...s.emptyState, ...INVISIBLE }}>{t.profileLoading}</div>
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
              data-tour={url === null ? 'profile-upload' : undefined}
              style={{
                ...s.primaryBtn,
                textAlign: 'center',
                cursor: mutationBusy ? 'default' : 'pointer',
                opacity: mutationBusy ? 0.6 : 1,
              }}
            >
              {busy ? t.profileUploading : url !== null ? t.profileReplace : t.profileUpload}
              <input
                ref={fileRef}
                id="profile-photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                disabled={mutationBusy}
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
                disabled={mutationBusy}
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

      {targetLoaded && pendingDelete ? (
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

  return (
    <>
      {photoCard}
      <ProfileCards
        key={props.barberId}
        dark={props.dark}
        lang={lang}
        s={s}
        barberId={props.barberId}
        barberName={props.barberName}
        isOwner={props.isOwner}
        onRosterChanged={props.onRosterChanged}
        port={props.profilePort ?? barberProfilePort}
      />
    </>
  )
}

interface ProfileCardsProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
  readonly isOwner: boolean
  readonly onRosterChanged: () => void
  readonly port: BarberProfilePort
}

type ProfileLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'loaded'; readonly profile: BarberSelfProfile }

/** The details and work cards, read once per barber; mounted per barber id by `ProfileView`. */
function ProfileCards(props: ProfileCardsProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [load, setLoad] = useState<ProfileLoad>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    void orderedProfileOperation(props.barberId, () => props.port.read(props.barberId)).then(
      (result) => {
        if (active)
          setLoad(result.ok ? { kind: 'loaded', profile: result.value } : { kind: 'failed' })
      },
    )
    return () => {
      active = false
    }
  }, [props.barberId, props.port])

  if (load.kind === 'loading') {
    const placeholder = (): JSX.Element => (
      <section style={{ ...s.card, ...INVISIBLE }}>
        <p style={s.emptyState}>{t.profileLoading}</p>
      </section>
    )
    return (
      <>
        {placeholder()}
        {placeholder()}
      </>
    )
  }
  if (load.kind === 'failed') {
    const failed = (title: string): JSX.Element => (
      <section style={s.card}>
        <h2 style={s.sectionTitle}>
          {title} · {props.barberName}
        </h2>
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{t.profileDetailsLoadError}</div>
      </section>
    )
    return (
      <>
        {failed(t.profileDetailsTitle)}
        {failed(t.workTitle)}
      </>
    )
  }
  return (
    <>
      <ProfileDetailsCard
        lang={props.lang}
        s={s}
        barberId={props.barberId}
        barberName={props.barberName}
        initial={load.profile.details}
        port={props.port}
        onNameSaved={props.onRosterChanged}
      />
      <WorkPhotosCard
        dark={props.dark}
        lang={props.lang}
        s={s}
        barberId={props.barberId}
        barberName={props.barberName}
        isOwner={props.isOwner}
        initial={load.profile.work}
        port={props.port}
      />
    </>
  )
}
