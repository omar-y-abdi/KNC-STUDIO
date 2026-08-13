// Barbers view (OWNER only). Lists the roster (incl. inactive), with: toggle active, edit
// name/ig/bios/role/sort, add a new barber, and provision a login account for an unlinked barber.
// The "Skapa inloggning" inline form calls the `admin-create-barber` edge function; on success the
// barber is optimistically marked as linked after a single-use invitation is sent. Every
// write is owner-only at the RLS layer.
//
// On narrow screens the list renders as stacked cards (no table); on wide screens as a compact
// 5-column table — Name (with muted id inline, since id is just a slug of the name), Instagram,
// login status, active status, and actions. The id column is dropped as a visible column.
//
// The edit form opens inline per row/card (a single "editing" id at a time) to keep the surface
// simple. Data effects (load/create/update/toggle) isolated here; the list + form are pure.

import type { JSX } from 'preact'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createBarberAccount } from '../adapters/barberAccountAdmin'
import {
  createBarber,
  deleteBarber,
  linkedBarberIds,
  listBarbers,
  setBarberActive,
  updateBarber,
} from '../adapters/barbersAdmin'
import { ConfirmDialog } from '../ConfirmDialog'
import { TypeToConfirmDialog } from '../TypeToConfirmDialog'
import { useNarrow } from '../chrome'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import type { AdminBarber, AdminBarberId, AdminStylesBundle } from './viewTypes'

export interface BarbersViewProps {
  readonly lang: Lang
  /** Drives the delete dialogs' light/dark theme (owned by the shell's single `useTheme`). */
  readonly dark: boolean
  readonly s: AdminStylesBundle
  /** Bubble a roster change up so the shell's barber selector + other views stay in sync. */
  readonly onRosterChanged: () => void
}

interface EditDraft {
  name: string
  ig: string
  roleSv: string
  roleEn: string
  bioSv: string
  bioEn: string
  active: boolean
  sortOrder: number
}

interface NewDraft extends EditDraft {
  id: string
}

const EMPTY_NEW: NewDraft = {
  id: '',
  name: '',
  ig: '',
  roleSv: 'Barberare',
  roleEn: 'Barber',
  bioSv: '',
  bioEn: '',
  active: true,
  sortOrder: 0,
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly barbers: readonly AdminBarber[] }

/** A barber pending the "also delete their bookings?" confirmation, carrying the exact counts. */
interface PurgeConfirm {
  readonly barber: AdminBarber
  readonly count: number
  readonly past: number
  readonly upcoming: number
}

export function BarbersView(props: BarbersViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const narrow = useNarrow()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [linked, setLinked] = useState<ReadonlySet<AdminBarberId>>(new Set())
  const [editingId, setEditingId] = useState<AdminBarberId | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // "Skapa inloggning" inline form — tracks which barber's form is open + the typed email.
  const [accountFormId, setAccountFormId] = useState<AdminBarberId | null>(null)
  const [accountEmail, setAccountEmail] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  // Two-step delete: first the type-the-id confirm (`deleteTarget`), then — only if the barber still
  // has bookings — the purge confirm (`purgeTarget`) carrying the counts. `deleteBusy` is isolated
  // from the edit/toggle `busy` so a delete in flight is never confused with a save.
  const [deleteTarget, setDeleteTarget] = useState<AdminBarber | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<PurgeConfirm | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const reload = async (): Promise<void> => {
    const [rosterRes, linkedRes] = await Promise.all([listBarbers(), linkedBarberIds()])
    if (rosterRes.ok) setLoad({ kind: 'ready', barbers: rosterRes.value })
    else setLoad({ kind: 'error', message: rosterRes.error.message })
    if (linkedRes.ok) setLinked(linkedRes.value)
  }

  // Initial load (once). `reload` is stable enough for this view's lifetime; an empty dep array is
  // intentional — the roster is re-fetched explicitly after each mutation, not on every render.
  useEffect(() => {
    void reload()
  }, [])

  const startEdit = (b: AdminBarber): void => {
    setEditingId(b.id)
    setEditDraft({
      name: b.name,
      ig: b.ig,
      roleSv: b.roleSv,
      roleEn: b.roleEn,
      bioSv: b.bioSv,
      bioEn: b.bioEn,
      active: b.active,
      sortOrder: b.sortOrder,
    })
    setNotice(null)
  }

  const saveEdit = async (id: AdminBarberId): Promise<void> => {
    if (editDraft === null) return
    setBusy(true)
    const result = await updateBarber(id, editDraft)
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setEditingId(null)
    setEditDraft(null)
    setNotice({ kind: 'ok', text: t.barbersUpdatedOk })
    await reload()
    props.onRosterChanged()
  }

  const toggleActive = async (b: AdminBarber): Promise<void> => {
    setBusy(true)
    const result = await setBarberActive(b.id, !b.active)
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setNotice({ kind: 'ok', text: b.active ? t.barbersHiddenOk : t.barbersActivatedOk })
    await reload()
    props.onRosterChanged()
  }

  const submitNew = async (): Promise<void> => {
    const id = newDraft.id.trim().toLowerCase()
    if (!/^[a-z0-9-]{1,32}$/.test(id)) {
      setNotice({ kind: 'err', text: t.barbersIdError })
      return
    }
    if (newDraft.name.trim() === '') {
      setNotice({ kind: 'err', text: t.barbersNameRequired })
      return
    }
    setBusy(true)
    const result = await createBarber({
      id,
      name: newDraft.name.trim(),
      ig: newDraft.ig.trim(),
      roleSv: newDraft.roleSv.trim() || 'Barberare',
      roleEn: newDraft.roleEn.trim() || 'Barber',
      bioSv: newDraft.bioSv,
      bioEn: newDraft.bioEn,
      sortOrder: newDraft.sortOrder,
    })
    setBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setAdding(false)
    setNewDraft(EMPTY_NEW)
    setNotice({ kind: 'ok', text: t.barbersAddedOk })
    await reload()
    props.onRosterChanged()
  }

  const toggleAccountForm = (barberId: AdminBarberId): void => {
    if (accountFormId === barberId) {
      setAccountFormId(null)
      setAccountEmail('')
    } else {
      setAccountFormId(barberId)
      setAccountEmail('')
      setNotice(null)
    }
  }

  const submitCreateAccount = async (barberId: AdminBarberId): Promise<void> => {
    const email = accountEmail.trim()
    if (!email.includes('@') || email.length < 3) {
      setNotice({ kind: 'err', text: t.barbersEmailError })
      return
    }
    setAccountBusy(true)
    const result = await createBarberAccount(email, barberId, lang)
    setAccountBusy(false)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    // Optimistic: mark this barber as linked for the rest of the session.
    setLinked(new Set([...linked, barberId]))
    setAccountFormId(null)
    setAccountEmail('')
    setNotice({
      kind: 'ok',
      text: t.barbersInviteSentNote,
    })
  }

  const startDelete = (b: AdminBarber): void => {
    setDeleteTarget(b)
    setNotice(null)
  }

  // Single delete path shared by both steps. `purge=false` is the first attempt (may return
  // `has_bookings`); `purge=true` is the confirmed purge. The switch is exhaustive over the outcome
  // union so every branch is handled — including `has_bookings`, which the adapter cannot return when
  // purge is true (a swap-to-purge-dialog there is harmless if it ever did).
  const runDelete = async (barber: AdminBarber, purge: boolean): Promise<void> => {
    setDeleteBusy(true)
    const outcome = await deleteBarber(barber.id, purge)
    setDeleteBusy(false)
    switch (outcome.kind) {
      case 'ok':
        setDeleteTarget(null)
        setPurgeTarget(null)
        setNotice({ kind: 'ok', text: t.barbersDeletedOk })
        await reload()
        props.onRosterChanged()
        return
      case 'has_bookings':
        // Swap the id-confirm for the purge confirm carrying the exact counts.
        setDeleteTarget(null)
        setPurgeTarget({
          barber,
          count: outcome.count,
          past: outcome.past,
          upcoming: outcome.upcoming,
        })
        return
      case 'error':
        // Close the dialogs so the notice (rendered behind the modal) is visible.
        setDeleteTarget(null)
        setPurgeTarget(null)
        setNotice({ kind: 'err', text: outcome.error.message })
        return
    }
  }

  const editField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    multiline = false,
  ): JSX.Element => (
    <div style={s.fieldRow}>
      <label style={s.label}>{label}</label>
      {multiline ? (
        <textarea
          style={s.textarea}
          maxLength={600}
          value={value}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      ) : (
        <input style={s.input} value={value} onInput={(e) => onChange(e.currentTarget.value)} />
      )}
    </div>
  )

  /** Shared inline edit form — used in both the card and the table expand row. */
  const renderEditForm = (id: AdminBarberId): JSX.Element => (
    <div
      style={{
        border: s.card.border,
        borderRadius: '12px',
        padding: '16px',
        marginTop: '8px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: '0 16px',
        }}
      >
        {editField(t.barbersFieldName, editDraft?.name ?? '', (v) =>
          setEditDraft(editDraft !== null ? { ...editDraft, name: v } : null),
        )}
        {editField(t.barbersFieldInstagram, editDraft?.ig ?? '', (v) =>
          setEditDraft(editDraft !== null ? { ...editDraft, ig: v } : null),
        )}
        {editField(t.barbersFieldRoleSv, editDraft?.roleSv ?? '', (v) =>
          setEditDraft(editDraft !== null ? { ...editDraft, roleSv: v } : null),
        )}
        {editField(t.barbersFieldRoleEn, editDraft?.roleEn ?? '', (v) =>
          setEditDraft(editDraft !== null ? { ...editDraft, roleEn: v } : null),
        )}
      </div>
      {editField(
        t.barbersFieldBioSv,
        editDraft?.bioSv ?? '',
        (v) => setEditDraft(editDraft !== null ? { ...editDraft, bioSv: v } : null),
        true,
      )}
      {editField(
        t.barbersFieldBioEn,
        editDraft?.bioEn ?? '',
        (v) => setEditDraft(editDraft !== null ? { ...editDraft, bioEn: v } : null),
        true,
      )}
      <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
        <button
          type="button"
          style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}
          onClick={() => void saveEdit(id)}
          disabled={busy}
        >
          {busy ? t.barbersSaving : t.barbersSave}
        </button>
        <button
          type="button"
          style={s.ghostBtn}
          onClick={() => {
            setEditingId(null)
            setEditDraft(null)
          }}
          disabled={busy}
        >
          {t.barbersCancel}
        </button>
      </div>
    </div>
  )

  /** Inline account form — creates a login or refreshes an expired invitation. */
  const renderAccountForm = (barberId: AdminBarberId): JSX.Element => (
    <div
      style={{
        border: s.card.border,
        borderRadius: '12px',
        padding: '14px 16px',
        marginTop: '8px',
      }}
    >
      <div style={s.fieldRow}>
        <label style={s.label}>{t.barbersFieldEmail}</label>
        <input
          type="email"
          autoComplete="email"
          placeholder={t.barbersEmailPlaceholder}
          style={s.input}
          value={accountEmail}
          onInput={(e) => setAccountEmail(e.currentTarget.value)}
          disabled={accountBusy}
        />
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
        <button
          type="button"
          style={{ ...s.primaryBtn, opacity: accountBusy ? 0.6 : 1 }}
          onClick={() => void submitCreateAccount(barberId)}
          disabled={accountBusy}
        >
          {accountBusy
            ? linked.has(barberId)
              ? t.barbersResending
              : t.barbersCreating
            : linked.has(barberId)
              ? t.barbersResendInvite
              : t.barbersCreate}
        </button>
        <button
          type="button"
          style={s.ghostBtn}
          onClick={() => {
            setAccountFormId(null)
            setAccountEmail('')
          }}
          disabled={accountBusy}
        >
          {t.barbersCancel}
        </button>
      </div>
    </div>
  )

  // Mobile: stacked cards — name first, muted id below, then login + status pills, Instagram,
  // and action buttons. No side-scrolling table on a phone.
  const renderBarberCards = (barbers: readonly AdminBarber[]): JSX.Element => {
    if (barbers.length === 0) return <div style={s.emptyState}>{t.barbersEmpty}</div>
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
        {barbers.map((b) => {
          const isEditing = editingId === b.id && editDraft !== null
          return (
            <Fragment key={b.id}>
              <div
                style={{
                  border: s.card.border,
                  borderRadius: '12px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  opacity: b.active ? 1 : 0.65,
                }}
              >
                {/* Name + id */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{b.name}</div>
                  <code style={{ fontSize: '11px', opacity: 0.55 }}>{b.id}</code>
                </div>
                {/* Status pills */}
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <span style={s.pill}>
                    {linked.has(b.id) ? t.barbersStatusLinked : t.barbersStatusUnlinked}
                  </span>
                  <span style={s.pill}>
                    {b.active ? t.barbersStatusActive : t.barbersStatusHidden}
                  </span>
                </div>
                {/* Instagram */}
                {b.ig !== '' ? (
                  <div style={{ ...s.mutedText, fontSize: '13px' }}>@{b.ig}</div>
                ) : null}
                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    style={s.ghostBtn}
                    onClick={() => (isEditing ? setEditingId(null) : startEdit(b))}
                  >
                    {isEditing ? t.barbersClose : t.barbersEdit}
                  </button>
                  <button
                    type="button"
                    style={s.ghostBtn}
                    onClick={() => void toggleActive(b)}
                    disabled={busy}
                  >
                    {b.active ? t.barbersHide : t.barbersActivate}
                  </button>
                  <button type="button" style={s.ghostBtn} onClick={() => toggleAccountForm(b.id)}>
                    {accountFormId === b.id
                      ? t.barbersClose
                      : linked.has(b.id)
                        ? t.barbersResendInvite
                        : t.barbersCreateLogin}
                  </button>
                  <button
                    type="button"
                    style={s.dangerBtn}
                    onClick={() => startDelete(b)}
                    disabled={deleteBusy}
                  >
                    {t.barbersDelete}
                  </button>
                </div>
              </div>
              {isEditing ? renderEditForm(b.id) : null}
              {accountFormId === b.id ? renderAccountForm(b.id) : null}
            </Fragment>
          )
        })}
      </div>
    )
  }

  return (
    <Fragment>
      <section style={s.card} aria-labelledby="barbers-heading">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h2 id="barbers-heading" style={s.sectionTitle}>
              {t.barbersTitle}
            </h2>
            <p style={s.sectionLead}>{t.barbersLead}</p>
          </div>
          {!adding ? (
            <button
              type="button"
              style={s.primaryBtn}
              onClick={() => {
                setAdding(true)
                setNewDraft(EMPTY_NEW)
                setNotice(null)
              }}
            >
              {t.barbersAddNew}
            </button>
          ) : null}
        </div>

        <div aria-live="polite" style={{ minHeight: '18px', margin: '8px 0 4px' }}>
          {notice !== null ? (
            <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
          ) : null}
        </div>

        {adding ? (
          <div
            style={{
              border: s.card.border,
              borderRadius: '12px',
              padding: '16px',
              margin: '8px 0 18px',
            }}
          >
            <h3 style={{ ...s.label, fontSize: '13px' }}>{t.barbersNewHeading}</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                gap: '0 16px',
              }}
            >
              {editField(t.barbersFieldId, newDraft.id, (v) => setNewDraft({ ...newDraft, id: v }))}
              {editField(t.barbersFieldName, newDraft.name, (v) =>
                setNewDraft({ ...newDraft, name: v }),
              )}
              {editField(t.barbersFieldInstagram, newDraft.ig, (v) =>
                setNewDraft({ ...newDraft, ig: v }),
              )}
              {editField(t.barbersFieldRoleSv, newDraft.roleSv, (v) =>
                setNewDraft({ ...newDraft, roleSv: v }),
              )}
              {editField(t.barbersFieldRoleEn, newDraft.roleEn, (v) =>
                setNewDraft({ ...newDraft, roleEn: v }),
              )}
            </div>
            {editField(
              t.barbersFieldBioSv,
              newDraft.bioSv,
              (v) => setNewDraft({ ...newDraft, bioSv: v }),
              true,
            )}
            {editField(
              t.barbersFieldBioEn,
              newDraft.bioEn,
              (v) => setNewDraft({ ...newDraft, bioEn: v }),
              true,
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}
                onClick={() => void submitNew()}
                disabled={busy}
              >
                {busy ? t.barbersSaving : t.barbersCreate}
              </button>
              <button
                type="button"
                style={s.ghostBtn}
                onClick={() => {
                  setAdding(false)
                  setNotice(null)
                }}
                disabled={busy}
              >
                {t.barbersCancel}
              </button>
            </div>
          </div>
        ) : null}

        {load.kind === 'loading' ? (
          <div style={s.emptyState}>{t.barbersLoading}</div>
        ) : load.kind === 'error' ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{load.message}</div>
        ) : narrow ? (
          renderBarberCards(load.barbers)
        ) : (
          // Wide screen: compact 5-column table. Id is shown subtly inside the Namn cell so the
          // separate Id column (which was just a slug of the name) is no longer needed.
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t.barbersColName}</th>
                  <th style={s.th}>{t.barbersColInstagram}</th>
                  <th style={s.th}>{t.barbersColLogin}</th>
                  <th style={s.th}>{t.barbersColStatus}</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>{t.barbersColAction}</th>
                </tr>
              </thead>
              <tbody>
                {load.barbers.map((b) => {
                  const isEditing = editingId === b.id && editDraft !== null
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td style={s.td}>
                          <span style={{ fontWeight: 600 }}>{b.name}</span>
                          <br />
                          <code style={{ fontSize: '11.5px', opacity: 0.55 }}>{b.id}</code>
                        </td>
                        <td style={s.td}>{b.ig === '' ? null : '@' + b.ig}</td>
                        <td style={s.td}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={s.pill}>
                              {linked.has(b.id) ? t.barbersStatusLinked : t.barbersStatusUnlinked}
                            </span>
                            <button
                              type="button"
                              style={s.ghostBtn}
                              onClick={() => toggleAccountForm(b.id)}
                            >
                              {accountFormId === b.id
                                ? t.barbersClose
                                : linked.has(b.id)
                                  ? t.barbersResendInvite
                                  : t.barbersCreateLogin}
                            </button>
                          </div>
                        </td>
                        <td style={s.td}>
                          <span style={s.pill}>
                            {b.active ? t.barbersStatusActive : t.barbersStatusHidden}
                          </span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            style={{ ...s.ghostBtn, marginRight: '8px' }}
                            onClick={() => (isEditing ? setEditingId(null) : startEdit(b))}
                          >
                            {isEditing ? t.barbersClose : t.barbersEdit}
                          </button>
                          <button
                            type="button"
                            style={s.ghostBtn}
                            onClick={() => void toggleActive(b)}
                            disabled={busy}
                          >
                            {b.active ? t.barbersHide : t.barbersActivate}
                          </button>
                          <button
                            type="button"
                            style={{ ...s.dangerBtn, marginLeft: '8px' }}
                            onClick={() => startDelete(b)}
                            disabled={deleteBusy}
                          >
                            {t.barbersDelete}
                          </button>
                        </td>
                      </tr>
                      {isEditing ? (
                        <tr key={b.id + '-edit'}>
                          <td style={{ ...s.td, padding: '0' }} colSpan={5}>
                            <div style={{ padding: '16px 10px 20px' }}>{renderEditForm(b.id)}</div>
                          </td>
                        </tr>
                      ) : null}
                      {accountFormId === b.id ? (
                        <tr key={b.id + '-account'}>
                          <td style={{ ...s.td, padding: '0' }} colSpan={5}>
                            <div style={{ padding: '16px 10px 20px' }}>
                              {renderAccountForm(b.id)}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleteTarget !== null ? (
        <TypeToConfirmDialog
          dark={props.dark}
          title={t.barbersDeleteTitle}
          body={t.barbersDeleteBody.replace('{name}', () => deleteTarget.name)}
          token={deleteTarget.id}
          confirmLabel={t.barbersDeleteConfirm}
          cancelLabel={t.barbersDeleteCancel}
          busy={deleteBusy}
          onConfirm={() => void runDelete(deleteTarget, false)}
          onClose={() => {
            if (!deleteBusy) setDeleteTarget(null)
          }}
        />
      ) : null}

      {purgeTarget !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.barbersDeleteTitle}
          body={t.barbersDeleteBookingsBody
            .replace('{count}', String(purgeTarget.count))
            .replace('{past}', String(purgeTarget.past))
            .replace('{upcoming}', String(purgeTarget.upcoming))}
          confirmLabel={t.barbersDeleteBookingsConfirm}
          cancelLabel={t.barbersDeleteBookingsCancel}
          danger
          busy={deleteBusy}
          onConfirm={() => void runDelete(purgeTarget.barber, true)}
          onClose={() => {
            if (!deleteBusy) setPurgeTarget(null)
          }}
        />
      ) : null}
    </Fragment>
  )
}
