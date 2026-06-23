// Barbers view (OWNER only). Lists the roster (incl. inactive), with: toggle active, edit
// name/ig/bios/role/sort, and add a new barber. The barber's LINKED login state is shown read-only
// ("Inloggning kopplad" / "Ej kopplad") — per v1, accounts are created + linked in the Supabase
// dashboard (a note explains this). Every write is owner-only at the RLS layer.
//
// The edit form opens inline per row (a single "editing" id at a time) to keep the surface simple.
// Data effects (load/create/update/toggle) isolated here; the table + form are otherwise pure.

import type { JSX } from 'preact'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import {
  createBarber,
  linkedBarberIds,
  listBarbers,
  setBarberActive,
  updateBarber,
} from '../adapters/barbersAdmin'
import type { AdminBarber, AdminBarberId, AdminStylesBundle } from './viewTypes'

export interface BarbersViewProps {
  readonly lang: Lang
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

export function BarbersView(props: BarbersViewProps): JSX.Element {
  const { s, lang } = props
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [linked, setLinked] = useState<ReadonlySet<AdminBarberId>>(new Set())
  const [editingId, setEditingId] = useState<AdminBarberId | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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
    setNotice({ kind: 'ok', text: 'Barberaren uppdaterad.' })
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
    setNotice({ kind: 'ok', text: b.active ? 'Barberaren dold.' : 'Barberaren aktiv.' })
    await reload()
    props.onRosterChanged()
  }

  const submitNew = async (): Promise<void> => {
    const id = newDraft.id.trim().toLowerCase()
    if (!/^[a-z0-9-]{1,32}$/.test(id)) {
      setNotice({ kind: 'err', text: 'Id får bara innehålla a–z, 0–9 och bindestreck (max 32).' })
      return
    }
    if (newDraft.name.trim() === '') {
      setNotice({ kind: 'err', text: 'Namn krävs.' })
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
    setNotice({ kind: 'ok', text: 'Barberare tillagd.' })
    await reload()
    props.onRosterChanged()
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
        <input
          style={s.input}
          value={value}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )}
    </div>
  )

  return (
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
            Barberare
          </h2>
          <p style={s.sectionLead}>
            Lägg till, redigera och dölj barberare. Inloggningskonton skapas och kopplas i Supabase
            (Auth) för v1 — kopplingsstatus visas nedan.
          </p>
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
            + Ny barberare
          </button>
        ) : null}
      </div>

      <div aria-live="polite" style={{ minHeight: '18px', margin: '8px 0 4px' }}>
        {notice !== null ? (
          <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
        ) : null}
      </div>

      {adding ? (
        <div style={{ border: s.card.border, borderRadius: '12px', padding: '16px', margin: '8px 0 18px' }}>
          <h3 style={{ ...s.label, fontSize: '13px' }}>Ny barberare</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0 16px' }}>
            {editField('Id (a–z, 0–9, -)', newDraft.id, (v) => setNewDraft({ ...newDraft, id: v }))}
            {editField('Namn', newDraft.name, (v) => setNewDraft({ ...newDraft, name: v }))}
            {editField('Instagram', newDraft.ig, (v) => setNewDraft({ ...newDraft, ig: v }))}
            {editField('Roll (SV)', newDraft.roleSv, (v) => setNewDraft({ ...newDraft, roleSv: v }))}
            {editField('Roll (EN)', newDraft.roleEn, (v) => setNewDraft({ ...newDraft, roleEn: v }))}
          </div>
          {editField('Bio (SV)', newDraft.bioSv, (v) => setNewDraft({ ...newDraft, bioSv: v }), true)}
          {editField('Bio (EN)', newDraft.bioEn, (v) => setNewDraft({ ...newDraft, bioEn: v }), true)}
          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button
              type="button"
              style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}
              onClick={() => void submitNew()}
              disabled={busy}
            >
              {busy ? 'Sparar …' : 'Skapa'}
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
              Avbryt
            </button>
          </div>
        </div>
      ) : null}

      {load.kind === 'loading' ? (
        <div style={s.emptyState}>Laddar barberare …</div>
      ) : load.kind === 'error' ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{load.message}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Namn</th>
                <th style={s.th}>Id</th>
                <th style={s.th}>Instagram</th>
                <th style={s.th}>Inloggning</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {load.barbers.map((b) => {
                const isEditing = editingId === b.id && editDraft !== null
                return (
                  <Fragment key={b.id}>
                    <tr>
                      <td style={s.td}>{b.name}</td>
                      <td style={s.td}>
                        <code style={{ fontSize: '12.5px', opacity: 0.8 }}>{b.id}</code>
                      </td>
                      <td style={s.td}>{b.ig === '' ? <span style={s.mutedText}>—</span> : '@' + b.ig}</td>
                      <td style={s.td}>
                        <span style={s.pill}>
                          {linked.has(b.id) ? 'Inloggning kopplad' : 'Ej kopplad'}
                        </span>
                      </td>
                      <td style={s.td}>
                        <span style={s.pill}>{b.active ? 'Aktiv' : 'Dold'}</span>
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ ...s.ghostBtn, marginRight: '8px' }}
                          onClick={() => (isEditing ? setEditingId(null) : startEdit(b))}
                        >
                          {isEditing ? 'Stäng' : 'Redigera'}
                        </button>
                        <button
                          type="button"
                          style={s.ghostBtn}
                          onClick={() => void toggleActive(b)}
                          disabled={busy}
                        >
                          {b.active ? 'Dölj' : 'Aktivera'}
                        </button>
                      </td>
                    </tr>
                    {isEditing && editDraft !== null ? (
                      <tr key={b.id + '-edit'}>
                        <td style={{ ...s.td, padding: '0' }} colSpan={6}>
                          <div style={{ padding: '16px 10px 20px' }}>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                                gap: '0 16px',
                              }}
                            >
                              {editField('Namn', editDraft.name, (v) =>
                                setEditDraft({ ...editDraft, name: v }),
                              )}
                              {editField('Instagram', editDraft.ig, (v) =>
                                setEditDraft({ ...editDraft, ig: v }),
                              )}
                              {editField('Roll (SV)', editDraft.roleSv, (v) =>
                                setEditDraft({ ...editDraft, roleSv: v }),
                              )}
                              {editField('Roll (EN)', editDraft.roleEn, (v) =>
                                setEditDraft({ ...editDraft, roleEn: v }),
                              )}
                            </div>
                            {editField(
                              `Bio (SV)`,
                              editDraft.bioSv,
                              (v) => setEditDraft({ ...editDraft, bioSv: v }),
                              true,
                            )}
                            {editField(
                              `Bio (EN)`,
                              editDraft.bioEn,
                              (v) => setEditDraft({ ...editDraft, bioEn: v }),
                              true,
                            )}
                            <div style={{ display: 'flex', gap: '10px' }}>
                              <button
                                type="button"
                                style={{ ...s.primaryBtn, opacity: busy ? 0.6 : 1 }}
                                onClick={() => void saveEdit(b.id)}
                                disabled={busy}
                              >
                                {busy ? 'Sparar …' : 'Spara'}
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
                                Avbryt
                              </button>
                            </div>
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
      <p style={{ ...s.mutedText, marginTop: '14px' }} lang={lang === 'en' ? 'en' : 'sv'}>
        Tips: för att ge en barberare inloggning, skapa kontot under Auth → Users i Supabase och lägg
        till en rad i <code>profiles</code> med deras barber-id.
      </p>
    </section>
  )
}
