// Services view — the per-barber service menu (Task 2 §1). The owner manages any barber's menu (via
// the shell's barber selector → `barberId`); a barber manages only their own (RLS is the backstop).
//
// Each service is an inline-editable row (name, price, length, active) with Save / Delete and reorder
// (↑/↓, which renumbers sort_order to the array index). "Add service" appends a new row. All writes go
// through `servicesAdmin` (Result-typed; errors surface per row, never thrown). Data effects live here;
// parsing/validation is pure (`parseServiceRow` in ../serviceValidation).

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { cap, weekdayLabel } from '../../booking/calendar'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import {
  createService,
  deleteService,
  listServices,
  updateService,
} from '../adapters/servicesAdmin'
import { parseServiceRow } from '../serviceValidation'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AdminService, Weekday } from '../types'
import type { AdminBarberId, AdminStylesBundle } from './viewTypes'

/** A row's editable buffer — price/length as strings so a half-typed field never coerces to a number. */
interface EditRow {
  readonly id: string
  readonly name: string
  readonly price: string
  readonly durationMin: string
  readonly active: boolean
  readonly sortOrder: number
  readonly availableWeekdays: readonly Weekday[]
  /** UI-only: all weekdays is the default but can still be edited before Save. */
  readonly specificDays: boolean
}

const WEEKDAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]
const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]

function toEdit(s: AdminService): EditRow {
  return {
    id: s.id,
    name: s.name,
    price: String(s.price),
    durationMin: String(s.durationMin),
    active: s.active,
    sortOrder: s.sortOrder,
    availableWeekdays: s.availableWeekdays,
    specificDays: s.availableWeekdays.length !== ALL_WEEKDAYS.length,
  }
}

export interface ServicesViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly barberId: AdminBarberId
  readonly barberName: string
}

export function ServicesView(props: ServicesViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)

  const [rows, setRows] = useState<readonly EditRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<EditRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [nName, setNName] = useState('')
  const [nPrice, setNPrice] = useState('')
  const [nDur, setNDur] = useState('')
  const [nSpecificDays, setNSpecificDays] = useState(false)
  const [nAvailableWeekdays, setNAvailableWeekdays] = useState<readonly Weekday[]>(ALL_WEEKDAYS)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoaded(false)
    setLoadError(null)
    setSavedId(null)
    setRowError(null)
    void listServices(props.barberId).then((r) => {
      if (!active) return
      if (!r.ok) {
        setLoadError(r.error.message)
        setLoaded(true)
        return
      }
      setRows(r.value.map(toEdit))
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [props.barberId])

  const setField = (id: string, patch: Partial<EditRow>): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setSavedId(null)
    if (rowError?.id === id) setRowError(null)
  }

  const save = async (row: EditRow): Promise<void> => {
    const parsed = parseServiceRow(row)
    if (parsed === null) {
      setRowError({ id: row.id, msg: t.svcValidation })
      return
    }
    setBusyId(row.id)
    setRowError(null)
    const r = await updateService(row.id, {
      ...parsed,
      active: row.active,
      sortOrder: row.sortOrder,
      availableWeekdays: row.availableWeekdays,
    })
    setBusyId(null)
    if (!r.ok) {
      setRowError({ id: row.id, msg: r.error.message })
      return
    }
    setRows((prev) => prev.map((x) => (x.id === row.id ? toEdit(r.value) : x)))
    setSavedId(row.id)
  }

  const move = async (index: number, dir: -1 | 1): Promise<void> => {
    const j = index + dir
    const a = rows[index]
    const b = rows[j]
    if (a === undefined || b === undefined) return
    const pa = parseServiceRow(a)
    const pb = parseServiceRow(b)
    if (pa === null || pb === null) {
      setRowError({ id: a.id, msg: t.svcValidation })
      return
    }
    setBusyId(a.id)
    setRowError(null)
    // a takes position j, b takes position index; sort_order is renumbered to the new index.
    const [ra, rb] = await Promise.all([
      updateService(a.id, {
        ...pa,
        active: a.active,
        sortOrder: j,
        availableWeekdays: a.availableWeekdays,
      }),
      updateService(b.id, {
        ...pb,
        active: b.active,
        sortOrder: index,
        availableWeekdays: b.availableWeekdays,
      }),
    ])
    setBusyId(null)
    if (!ra.ok || !rb.ok) {
      setRowError({ id: a.id, msg: t.svcSaveError })
      return
    }
    setRows((prev) => {
      const next = [...prev]
      next[index] = b
      next[j] = a
      return next.map((r, i) => ({ ...r, sortOrder: i }))
    })
  }

  const confirmDelete = async (): Promise<void> => {
    const target = pendingDelete
    if (target === null) return
    setDeleteBusy(true)
    const r = await deleteService(target.id)
    setDeleteBusy(false)
    setPendingDelete(null)
    if (!r.ok) {
      setRowError({ id: target.id, msg: r.error.message })
      return
    }
    setRows((prev) => prev.filter((x) => x.id !== target.id))
  }

  const add = async (): Promise<void> => {
    const parsed = parseServiceRow({ name: nName, price: nPrice, durationMin: nDur })
    if (parsed === null) {
      setAddError(t.svcValidation)
      return
    }
    setAddBusy(true)
    setAddError(null)
    const r = await createService(props.barberId, {
      ...parsed,
      sortOrder: rows.length,
      availableWeekdays: nAvailableWeekdays,
    })
    setAddBusy(false)
    if (!r.ok) {
      setAddError(r.error.message)
      return
    }
    setRows((prev) => [...prev, toEdit(r.value)])
    setNName('')
    setNPrice('')
    setNDur('')
    setNSpecificDays(false)
    setNAvailableWeekdays(ALL_WEEKDAYS)
  }

  const numInput = (value: string, onInput: (v: string) => void, width: string): JSX.Element => (
    <input
      style={{ ...s.input, width, textAlign: 'right' }}
      inputMode="decimal"
      value={value}
      onInput={(e) => onInput(e.currentTarget.value)}
    />
  )

  const iconBtn = (
    label: string,
    disabled: boolean,
    onClick: () => void,
    glyph: string,
  ): JSX.Element => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{ ...s.ghostBtn, padding: '8px 11px', opacity: disabled ? 0.35 : 1 }}
    >
      {glyph}
    </button>
  )

  const weekdayPicker = (
    weekdays: readonly Weekday[],
    onChange: (next: readonly Weekday[]) => void,
  ): JSX.Element => (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 12px', padding: '4px 0 1px' }}
      role="group"
      aria-label={t.svcSpecificDays}
    >
      {WEEKDAY_ORDER.map((weekday) => {
        const selected = weekdays.includes(weekday)
        return (
          <label key={weekday} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <input
              type="checkbox"
              checked={selected}
              disabled={selected && weekdays.length === 1}
              onInput={(e) => {
                if (e.currentTarget.checked) {
                  onChange([...weekdays, weekday].sort((a, b) => a - b) as readonly Weekday[])
                } else {
                  onChange(weekdays.filter((item) => item !== weekday))
                }
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {cap(weekdayLabel(lang, weekday))}
            </span>
          </label>
        )
      })}
    </div>
  )

  const serviceRow = (row: EditRow, index: number): JSX.Element => {
    const busy = busyId === row.id
    return (
      <div
        key={row.id}
        style={{
          border: s.card.border,
          borderRadius: '12px',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          opacity: row.active ? 1 : 0.72,
        }}
      >
        <div
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 12px' }}
        >
          <label style={{ flex: '1 1 200px', minWidth: '150px' }}>
            <span style={s.label}>{t.svcColName}</span>
            <input
              style={s.input}
              maxLength={80}
              value={row.name}
              placeholder={t.svcNamePh}
              onInput={(e) => setField(row.id, { name: e.currentTarget.value })}
            />
          </label>
          <label>
            <span style={s.label}>{t.svcColPrice}</span>
            {numInput(row.price, (v) => setField(row.id, { price: v }), '92px')}
          </label>
          <label>
            <span style={s.label}>{t.svcColDuration}</span>
            {numInput(row.durationMin, (v) => setField(row.id, { durationMin: v }), '104px')}
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              paddingBottom: '9px',
            }}
          >
            <input
              type="checkbox"
              checked={row.active}
              onInput={(e) => setField(row.id, { active: e.currentTarget.checked })}
            />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.svcActive}</span>
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              paddingBottom: '9px',
            }}
          >
            <input
              type="checkbox"
              checked={row.specificDays}
              onInput={(e) =>
                setField(row.id, {
                  specificDays: e.currentTarget.checked,
                  availableWeekdays: e.currentTarget.checked ? row.availableWeekdays : ALL_WEEKDAYS,
                })
              }
            />
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.svcSpecificDays}</span>
          </label>
        </div>

        {row.specificDays ? (
          <div>
            <span style={s.label}>{t.svcSpecificDaysLead}</span>
            {weekdayPicker(row.availableWeekdays, (availableWeekdays) =>
              setField(row.id, { availableWeekdays }),
            )}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {iconBtn(t.svcMoveUp, busy || index === 0, () => void move(index, -1), '↑')}
          {iconBtn(
            t.svcMoveDown,
            busy || index === rows.length - 1,
            () => void move(index, 1),
            '↓',
          )}
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => void save(row)}
          >
            {busy ? t.svcSaving : t.svcSave}
          </button>
          <button type="button" style={s.dangerBtn} onClick={() => setPendingDelete(row)}>
            {t.svcDelete}
          </button>
          {!row.active ? (
            <span style={{ ...s.mutedText, fontSize: '12px' }}>{t.svcInactiveTag}</span>
          ) : null}
          <span aria-live="polite" style={{ marginLeft: 'auto' }}>
            {savedId === row.id ? <span style={s.successText}>{t.svcSaved}</span> : null}
            {rowError?.id === row.id ? <span style={s.errorText}>{rowError.msg}</span> : null}
          </span>
        </div>
      </div>
    )
  }

  return (
    <section style={s.card} aria-labelledby="services-heading">
      <h2 id="services-heading" style={s.sectionTitle}>
        {t.servicesTitle} · {props.barberName}
      </h2>
      <p style={s.sectionLead}>{t.servicesLead}</p>

      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>{t.svcLoading}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
          {rows.length === 0 ? <div style={s.emptyState}>{t.svcEmpty}</div> : rows.map(serviceRow)}

          {/* Add form */}
          <div
            style={{
              border: s.card.border,
              borderRadius: '12px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginTop: '4px',
            }}
          >
            <h3 style={{ ...s.label, fontSize: '13px', margin: 0 }}>{t.svcAddTitle}</h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                gap: '10px 12px',
              }}
            >
              <label style={{ flex: '1 1 200px', minWidth: '150px' }}>
                <span style={s.label}>{t.svcColName}</span>
                <input
                  style={s.input}
                  maxLength={80}
                  value={nName}
                  placeholder={t.svcNamePh}
                  onInput={(e) => {
                    setNName(e.currentTarget.value)
                    setAddError(null)
                  }}
                />
              </label>
              <label>
                <span style={s.label}>{t.svcColPrice}</span>
                {numInput(
                  nPrice,
                  (v) => {
                    setNPrice(v)
                    setAddError(null)
                  },
                  '92px',
                )}
              </label>
              <label>
                <span style={s.label}>{t.svcColDuration}</span>
                {numInput(
                  nDur,
                  (v) => {
                    setNDur(v)
                    setAddError(null)
                  },
                  '104px',
                )}
              </label>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  paddingBottom: '9px',
                }}
              >
                <input
                  type="checkbox"
                  checked={nSpecificDays}
                  onInput={(e) => {
                    setNSpecificDays(e.currentTarget.checked)
                    if (!e.currentTarget.checked) setNAvailableWeekdays(ALL_WEEKDAYS)
                  }}
                />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.svcSpecificDays}</span>
              </label>
              <button
                type="button"
                style={{ ...s.primaryBtn, opacity: addBusy ? 0.6 : 1 }}
                disabled={addBusy}
                onClick={() => void add()}
              >
                {addBusy ? t.svcAdding : t.svcAddBtn}
              </button>
            </div>
            {nSpecificDays ? (
              <div>
                <span style={s.label}>{t.svcSpecificDaysLead}</span>
                {weekdayPicker(nAvailableWeekdays, setNAvailableWeekdays)}
              </div>
            ) : null}
            <div aria-live="polite" style={{ minHeight: '18px' }}>
              {addError !== null ? <span style={s.errorText}>{addError}</span> : null}
            </div>
          </div>
        </div>
      )}

      {pendingDelete !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.svcDeleteTitle}
          body={t.svcDeleteBody}
          confirmLabel={t.svcDeleteConfirm}
          cancelLabel={t.svcDeleteCancel}
          danger
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onClose={() => {
            if (!deleteBusy) setPendingDelete(null)
          }}
        />
      ) : null}
    </section>
  )
}
