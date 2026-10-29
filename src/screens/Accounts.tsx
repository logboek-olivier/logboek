import { FileUp, Landmark, Plus, Trash2 } from 'lucide-react'
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { NoteField } from '../components/NoteField'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { ViewRows } from '../components/Views'
import { formatDate, formatMoney, formatMonth } from '../format'
import { getLang, t, type MessageKey } from '../i18n'
import { columnChoices, detectPreset, guessMapping, MappingIncompleteError, monthlyPoints, readBalances, type ColumnMapping, type ImportMode, type ImportResult, type PresetId } from '../import/accounts'
import { FileFormatError, readRowSources, type SheetRow } from '../import/rows'
import {
  accountBalances,
  balanceOn,
  cleanAccount,
  DEFAULT_KIND,
  deleteAccount,
  deleteBalance,
  isDebt,
  liveAccounts,
  parseStand,
  netWorth,
  netWorthSeries,
  pace,
  saveAccount,
  setBalance,
  signedAmount,
  toEur,
  writeBalances,
  type AccountInput,
} from '../model/accounts'
import { getRates, subscribeRates } from '../model/rates'
import { ACCOUNT_KINDS, ACCOUNT_PROVIDERS, CURRENCIES, todayIso, type Account, type AccountProvider, type Balance, type Currency } from '../model/types'
import type { Store } from '../storage/store'

// Meer → Rekeningen: de netto waarde (laatste stand per rekening, in euro, schulden negatief), het tempo ("nog N maanden
// tot netto waarde positief") en per rekening de standen per maand. Een stand komt met de hand of uit een export van de
// bank of broker; alleen de stand per maand wordt bewaard. De voorinstellingen voor ASN, Revolut, BUX en DEGIRO zijn nog
// niet getest met een echte export: wijkt een bestand af, dan koppelt Olivier de kolommen zelf.

const providerLabel = (p: AccountProvider) => t(`accounts.provider.${p}` as MessageKey)
const kindLabel = (k: Account['kind']) => t(`accounts.kind.${k}` as MessageKey)

function useRates() {
  return useSyncExternalStore(subscribeRates, getRates)
}

type Open = { kind: 'view'; account: Account } | { kind: 'new' } | null

export function Accounts({ store, notify }: { store: Store; notify: Notify }) {
  const rates = useRates()
  const accounts = liveAccounts(useCollection(store, 'accounts.json.enc'))
  const balances = useCollection(store, 'balances.json.enc')
  const [open, setOpen] = useState<Open>(null)
  const today = todayIso()
  const worth = netWorth(accounts, balances, today, rates)
  const tempo = pace(accounts, balances, today, rates)
  const series = netWorthSeries(accounts, balances, today, rates, 6).filter((m) => m.worth !== null)

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('accounts.screen')}</h1>
      </header>

      {accounts.length === 0 ? (
        <Empty icon={Landmark}>{t('accounts.empty')}</Empty>
      ) : (
        <>
          <dl className="grid">
            <div className="stat hero wide">
              <dt>{t('accounts.netWorth')}</dt>
              <dd className={worth.eur >= 0 ? 'positive' : 'negative'}>
                {formatMoney(worth.eur, 'EUR')}
                {worth.provisional && <span className="muted small">{` · ${t('money.provisional')}`}</span>}
              </dd>
            </div>
            {Object.entries(worth.other).map(([c, v]) => (
              <div key={c} className="stat wide">
                <dt>{t('accounts.noRate', { currency: c })}</dt>
                <dd className="small">{formatMoney(v, c)}</dd>
              </div>
            ))}
          </dl>
          <p className="accounts-pace">{paceText(tempo)}</p>
          {worth.oldest && worth.oldest < addDaysIso(today, -45) && <p className="muted small">{t('accounts.oldStand', { date: formatDate(worth.oldest) })}</p>}

          {series.length > 1 && (
            <div className="section">
              <h2>{t('accounts.perMonth')}</h2>
              <ul className="rows">
                {series.map((m, i) => {
                  const previous = series[i - 1]?.worth?.eur
                  const change = previous === undefined ? null : m.worth!.eur - previous
                  return (
                    <li key={m.month} className="row-item">
                      <span className="row-main">{formatMonth(m.month)}</span>
                      {change !== null && <span className={`muted small${change < 0 ? ' negative' : ''}`}>{`${change >= 0 ? '+' : '−'}${formatMoney(Math.abs(change), 'EUR')}`}</span>}
                      <span className="row-value">{formatMoney(m.worth!.eur, 'EUR')}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="section">
            <h2>{t('accounts.list')}</h2>
            <ul className="rows">
              {accounts.map((a) => {
                const last = balanceOn(balances, a.id, today)
                const eur = last && a.currency !== 'EUR' ? toEur(last.amount, a.currency, today, rates) : null
                return (
                  <li key={a.id}>
                    <button type="button" className="row-button" onClick={() => setOpen({ kind: 'view', account: a })}>
                      <span className="row-main">
                        <span className="row-title">{a.name}</span>
                        <span className="muted small">
                          {[a.name === providerLabel(a.provider) ? '' : providerLabel(a.provider), kindLabel(a.kind), a.closedAt ? t('accounts.closedOn', { date: formatDate(a.closedAt) }) : last ? formatDate(last.date) : t('accounts.noStand')].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {last && (
                        <span className={`row-value${last.amount < 0 ? ' negative' : ''}`}>
                          {formatMoney(last.amount, a.currency)}
                          {eur && <span className="muted small accounts-eur">{formatMoney(eur.eur, 'EUR')}</span>}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
      <button type="button" className="btn primary" onClick={() => setOpen({ kind: 'new' })}>
        <Icon icon={Plus} />
        {t('accounts.add')}
      </button>
      <p className="muted small">{t('accounts.privacy')}</p>

      {open?.kind === 'view' && <AccountView key={open.account.id} store={store} account={open.account} notify={notify} onClose={() => setOpen(null)} />}
      {open?.kind === 'new' && <AccountSheet store={store} account={null} notify={notify} onClose={() => setOpen(null)} />}
    </section>
  )
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function paceText(p: ReturnType<typeof pace>): string {
  if (p.state === 'te-weinig') return t('accounts.pace.tooLittle')
  if (p.state === 'positief') return t('accounts.pace.positive')
  const per = `${p.perMonth >= 0 ? '+' : '−'}${formatMoney(Math.abs(p.perMonth), 'EUR')}`
  if (p.state === 'niet') return t('accounts.pace.never', { per })
  return t('accounts.pace.months', { n: p.months, per })
}

function AccountView({ store, account, notify, onClose }: { store: Store; account: Account; notify: Notify; onClose: () => void }) {
  const rates = useRates()
  const current = useCollection(store, 'accounts.json.enc').find((a) => a.id === account.id) ?? account
  const balances = accountBalances(useCollection(store, 'balances.json.enc'), current.id)
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stand, setStand] = useState<Balance | null>(null)
  const last = balances[0]
  const eur = last && current.currency !== 'EUR' ? toEur(last.amount, current.currency, todayIso(), rates) : null

  if (editing) return <AccountSheet store={store} account={current} notify={notify} onClose={onClose} />
  if (current.deletedAt !== null) return null

  return (
    <Sheet title={current.name} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <ViewRows
          rows={[
            [t('accounts.provider'), providerLabel(current.provider)],
            [t('accounts.kind'), kindLabel(current.kind)],
            [t('field.currency'), current.currency],
            [t('accounts.lastStand'), last && `${formatMoney(last.amount, current.currency)}${eur ? ` (${formatMoney(eur.eur, 'EUR')})` : ''} · ${formatDate(last.date)}`],
            [t('accounts.closedAt'), current.closedAt && formatDate(current.closedAt)],
            [t('field.note'), current.note],
          ]}
        />
        <BalanceForm store={store} account={current} notify={notify} />
        <button type="button" className="btn" onClick={() => setImporting(true)}>
          <Icon icon={FileUp} />
          {t('accounts.import')}
        </button>
        {balances.length > 0 && (
          <div className="section">
            <h2>{t('accounts.history')}</h2>
            <ul className="rows">
              {balances.map((b) => (
                <li key={b.id}>
                  <button type="button" className="row-button" onClick={() => setStand(b)}>
                    <span className="row-main">
                      <span className="row-title">{formatDate(b.date)}</span>
                      <span className="muted small">{t(b.source === 'import' ? 'accounts.fromImport' : 'accounts.byHand')}</span>
                    </span>
                    <span className={`row-value${b.amount < 0 ? ' negative' : ''}`}>{formatMoney(b.amount, current.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {importing && <ImportSheet store={store} account={current} notify={notify} onClose={() => setImporting(false)} />}
      {stand && <BalanceView store={store} account={current} balance={stand} notify={notify} onClose={() => setStand(null)} />}
    </Sheet>
  )
}

/** Stand bijwerken: datum (vandaag) en bedrag; bij een schuld het openstaande bedrag. */
function BalanceForm({ store, account, notify }: { store: Store; account: Account; notify: Notify }) {
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState('')
  const value = parseStand(amount, getLang())
  const ok = value !== null && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    const written = await setBalance(store, account, date, value)
    setAmount('')
    notify(written ? t('accounts.standSaved') : t('accounts.standNewer'))
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="two">
        <label>
          {t(isDebt(account) ? 'accounts.debtAmount' : 'accounts.standAmount')}
          <input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          {t('field.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <button className="btn" type="submit" disabled={!ok}>
        {t('accounts.updateStand')}
      </button>
    </form>
  )
}

function BalanceView({ store, account, balance, notify, onClose }: { store: Store; account: Account; balance: Balance; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  // Een schuld als openstaand bedrag (positief), een gewone rekening met teken; het decimaalteken van de taal.
  const shown = isDebt(account) ? Math.abs(balance.amount) : balance.amount
  const [amount, setAmount] = useState(getLang() === 'nl' ? String(shown).replace('.', ',') : String(shown))
  const value = parseStand(amount, getLang())

  async function save(e: FormEvent) {
    e.preventDefault()
    if (value === null) return
    await store.put('balances.json.enc', { ...balance, amount: signedAmount(account, value), source: 'handmatig', updatedAt: new Date().toISOString() })
    onClose()
    notify(t('accounts.standSaved'))
  }

  async function remove() {
    const undo = await deleteBalance(store, balance)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  if (editing)
    return (
      <Sheet title={formatDate(balance.date)} onClose={onClose}>
        <form className="stack" onSubmit={(e) => void save(e)}>
          <label>
            {t(isDebt(account) ? 'accounts.debtAmount' : 'accounts.standAmount')}
            <input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="sheet-actions">
            <button className="btn primary" type="submit" disabled={value === null}>
              {t('common.save')}
            </button>
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          </div>
        </form>
      </Sheet>
    )
  return (
    <Sheet title={formatDate(balance.date)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <ViewRows
          rows={[
            [t(isDebt(account) ? 'accounts.debtAmount' : 'accounts.standAmount'), formatMoney(balance.amount, account.currency)],
            [t('accounts.source'), t(balance.source === 'import' ? 'accounts.fromImport' : 'accounts.byHand')],
          ]}
        />
      </div>
    </Sheet>
  )
}

function AccountSheet({ store, account, notify, onClose }: { store: Store; account: Account | null; notify: Notify; onClose: () => void }) {
  const [input, setInput] = useState<AccountInput>({
    name: account?.name ?? '',
    provider: account?.provider ?? 'asn',
    kind: account?.kind ?? 'betaal',
    currency: account?.currency ?? 'EUR',
    note: account?.note ?? '',
    closedAt: account?.closedAt ?? '',
  })
  const [nameTouched, setNameTouched] = useState(!!account)
  const [busy, setBusy] = useState(false)
  const name = input.name.trim() || providerLabel(input.provider)

  function pickProvider(provider: AccountProvider) {
    setInput({ ...input, provider, kind: account ? input.kind : DEFAULT_KIND[provider], name: nameTouched ? input.name : '' })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await saveAccount(store, account?.id ?? null, cleanAccount({ ...input, name }))
    onClose()
    notify(t('accounts.saved'))
  }

  async function remove() {
    if (!account) return
    const undo = await deleteAccount(store, account)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t(account ? 'accounts.edit' : 'accounts.add')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="type-buttons" role="radiogroup" aria-label={t('accounts.provider')}>
          {ACCOUNT_PROVIDERS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={input.provider === p} className={`chip${input.provider === p ? ' active' : ''}`} onClick={() => pickProvider(p)}>
              {providerLabel(p)}
            </button>
          ))}
        </div>
        <label>
          {t('accounts.name')}
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="sentences"
            maxLength={60}
            placeholder={providerLabel(input.provider)}
            value={input.name}
            onChange={(e) => {
              setNameTouched(true)
              setInput({ ...input, name: e.target.value })
            }}
          />
        </label>
        <div className="two">
          <label>
            {t('accounts.kind')}
            <select value={input.kind} onChange={(e) => setInput({ ...input, kind: e.target.value as Account['kind'] })}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('field.currency')}
            <select value={input.currency} onChange={(e) => setInput({ ...input, currency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isDebt(input) && <p className="muted small">{t('accounts.debtHint')}</p>}
        {account && (
          <label>
            {t('accounts.closedAt')}
            <input type="date" value={input.closedAt} onChange={(e) => setInput({ ...input, closedAt: e.target.value })} />
          </label>
        )}
        <NoteField label={t('field.note')} value={input.note} onChange={(note) => setInput({ ...input, note })} maxLength={500} />
        <p className="muted small">{t('accounts.noNumbers')}</p>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {t('common.save')}
          </button>
          {account && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

const MODES: ImportMode[] = ['saldo', 'voor-plus-bedrag', 'bedragen', 'totaal']

/**
 * Importeren: bestand kiezen (zonder filter), herkende voorinstelling of zelf kolommen koppelen, voorbeeld, opslaan.
 * Het bestand blijft op het apparaat; alleen de stand per maand wordt opgeslagen.
 */
function ImportSheet({ store, account, notify, onClose }: { store: Store; account: Account; notify: Notify; onClose: () => void }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null)
  const [preset, setPreset] = useState<PresetId | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [current, setCurrent] = useState('')
  const [onDate, setOnDate] = useState(todayIso())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(file: File | undefined) {
    setError(null)
    setRows(null)
    if (!file) return
    try {
      const { sheets } = readRowSources(new Uint8Array(await file.arrayBuffer()))
      const first = sheets.find((s) => s.length > 0) ?? []
      if (first.length === 0) throw new FileFormatError(t('import.fileEmpty'))
      const found = detectPreset(first, account.currency)
      setRows(first)
      setPreset(found?.preset ?? null)
      setMapping(found?.mapping ?? guessMapping(first))
      setAdjusting(!found)
    } catch (e) {
      setError(e instanceof FileFormatError ? e.message : t('accounts.importUnreadable'))
    }
  }

  let result: ImportResult | null = null
  let incomplete = false
  if (rows && mapping) {
    try {
      result = readBalances(rows, mapping, { currentBalance: parseStand(current, getLang()) ?? undefined, onDate })
    } catch (e) {
      if (e instanceof MappingIncompleteError) incomplete = true
      else throw e
    }
  }
  // Bij een schuld altijd negatief, ook als de export de schuld positief noemt.
  const points = result ? monthlyPoints(result.points).map((p) => ({ ...p, amount: isDebt(account) ? -Math.abs(p.amount) : p.amount })) : []
  const choices = rows && mapping ? columnChoices(rows, mapping.headerRow) : []

  async function save() {
    if (points.length === 0) return
    setBusy(true)
    const written = await writeBalances(store, account, points, 'import')
    onClose()
    notify(t('accounts.imported', { n: written.length }))
  }

  const columnSelect = (label: MessageKey, key: 'date' | 'balance' | 'amount' | 'value') => (
    <label>
      {t(label)}
      <select value={mapping?.[key] ?? ''} onChange={(e) => setMapping({ ...mapping!, [key]: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">{t('accounts.map.none')}</option>
        {choices.map((c) => (
          <option key={c.index} value={c.index}>
            {`${c.header || t('accounts.map.column', { n: c.index + 1 })}${c.sample ? ` (${c.sample})` : ''}`}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <Sheet title={t('accounts.importTitle', { name: account.name })} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('accounts.importIntro')}</p>
        <label>
          {t('accounts.chooseFile')}
          <input type="file" onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {rows && mapping && (
          <>
            <div className="notice" role="note">
              <span>{preset ? t('accounts.recognised', { name: t(`accounts.preset.${preset}` as MessageKey) }) : t('accounts.notRecognised')}</span>
            </div>
            {preset === 'bux' && <p className="muted small">{t('accounts.buxCashOnly')}</p>}
            {!adjusting && (
              <button type="button" className="btn link" onClick={() => setAdjusting(true)}>
                {t('accounts.adjust')}
              </button>
            )}
            {adjusting && (
              <fieldset className="stack">
                <legend>{t('accounts.map.title')}</legend>
                <label>
                  {t('accounts.map.mode')}
                  <select value={mapping.mode} onChange={(e) => setMapping({ ...mapping, mode: e.target.value as ImportMode })}>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`accounts.mode.${m}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={mapping.headerRow !== null} onChange={(e) => setMapping({ ...mapping, headerRow: e.target.checked ? 0 : null })} />
                  {t('accounts.map.header')}
                </label>
                {mapping.mode !== 'totaal' && columnSelect('accounts.map.date', 'date')}
                {(mapping.mode === 'saldo' || mapping.mode === 'voor-plus-bedrag') && columnSelect(mapping.mode === 'saldo' ? 'accounts.map.balanceAfter' : 'accounts.map.balanceBefore', 'balance')}
                {(mapping.mode === 'voor-plus-bedrag' || mapping.mode === 'bedragen') && columnSelect('accounts.map.amount', 'amount')}
                {mapping.mode === 'totaal' && columnSelect('accounts.map.value', 'value')}
                {mapping.filters.length > 0 && (
                  <div className="stack">
                    {mapping.filters.map((f, i) => (
                      <div key={i} className="row">
                        <span className="row-main small">{t('accounts.map.filter', { column: choices[f.column]?.header || t('accounts.map.column', { n: f.column + 1 }), value: f.value })}</span>
                        <button type="button" className="btn link small" onClick={() => setMapping({ ...mapping, filters: mapping.filters.filter((_, j) => j !== i) })}>
                          {t('accounts.map.removeFilter')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            {mapping.mode === 'bedragen' && (
              <label>
                {t('accounts.currentBalance')}
                <input type="text" inputMode="decimal" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </label>
            )}
            {mapping.mode === 'totaal' && (
              <label>
                {t('accounts.onDate')}
                <input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
              </label>
            )}
            {incomplete && <p className="muted">{t('accounts.map.incomplete')}</p>}
            {result && (
              <div className="stack" aria-live="polite">
                {points.length > 0 ? (
                  <p>
                    {t('accounts.preview', { n: points.length, from: formatMonth(points[0]!.date.slice(0, 7)), to: formatMonth(points.at(-1)!.date.slice(0, 7)) })}
                    <br />
                    {t('accounts.previewLast', { amount: formatMoney(points.at(-1)!.amount, account.currency), date: formatDate(points.at(-1)!.date) })}
                  </p>
                ) : (
                  <p className="muted">{t('accounts.previewNone')}</p>
                )}
                {result.problems.length > 0 && (
                  <p className="muted small">
                    {t('accounts.problems', {
                      n: result.problems.length,
                      where: result.problems
                        .slice(0, 5)
                        .map((p) => t('accounts.rowColumn', { row: p.row, column: p.column }))
                        .join(', '),
                    })}
                  </p>
                )}
              </div>
            )}
            <button type="button" className="btn primary" disabled={points.length === 0 || busy} onClick={() => void save()}>
              {t('accounts.importSave', { n: points.length })}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}
