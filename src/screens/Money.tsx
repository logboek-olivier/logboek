import { useCollection } from '../components/useCollection'
import { formatDate, formatDateShort, formatMoney } from '../format'
import { active } from '../model/derive'
import { isIncome, perMonth, perSource, tipsPerWeek, totals, type MoneyTotals } from '../model/money'
import { KIND_LABELS, SOURCE_LABELS, todayIso, type Transaction } from '../model/types'
import type { Store } from '../storage/store'

// Geld: zeilgeld per maand, per bron, fooi per week (12 weken), lijst met verwijderen. Geen netto waarde.

const monthFormat = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' })

export function Money({ store, onDone }: { store: Store; onDone: (message: string) => void }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  const live = active(transactions).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1))
  const all = totals(live)
  const months = perMonth(live)
  const sources = perSource(live)
  const weeks = tipsPerWeek(live, todayIso())
  const maxWeek = Math.max(1, ...weeks.map((w) => w.eur))

  async function remove(tx: Transaction) {
    const label = `${KIND_LABELS[tx.kind]} van ${formatMoney(tx.amount, tx.currency)} op ${formatDate(tx.date)} verwijderen?`
    if (!window.confirm(label)) return
    await store.remove('transactions.json.enc', tx.id)
    void store.sync()
    onDone('Verwijderd')
  }

  return (
    <section className="stack">
      <h1>Geld</h1>
      {live.length === 0 && <p className="muted">Nog geen zeilgeld. Voeg een fooi of kosten toe met +.</p>}
      {live.length > 0 && (
        <>
          <dl className="grid">
            <Stat label="Inkomsten" value={formatMoney(all.incomeEur, 'EUR')} />
            <Stat label="Kosten" value={formatMoney(all.costsEur, 'EUR')} />
            <Stat label="Saldo" value={formatMoney(all.balanceEur, 'EUR')} tone={all.balanceEur >= 0 ? 'positive' : 'negative'} />
            <OtherStat other={all.other} />
          </dl>

          <h2>Per maand</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Maand</th>
                <th className="num">In</th>
                <th className="num">Uit</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {monthFormat.format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5)) - 1, 1))}
                    <OtherLine other={m.other} />
                  </td>
                  <td className="num">{formatMoney(m.incomeEur, 'EUR')}</td>
                  <td className="num">{formatMoney(m.costsEur, 'EUR')}</td>
                  <td className={`num ${m.balanceEur >= 0 ? 'positive' : 'negative'}`}>{formatMoney(m.balanceEur, 'EUR')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Per bron</h2>
          <table className="table">
            <tbody>
              {sources.map((s) => (
                <tr key={s.source}>
                  <td>
                    {SOURCE_LABELS[s.source]}
                    <OtherLine other={s.other} />
                  </td>
                  <td className="num">{formatMoney(s.incomeEur, 'EUR')}</td>
                  <td className="num">{formatMoney(s.costsEur, 'EUR')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Fooi per week</h2>
          <ol className="bars" aria-label="Fooi per week, laatste 12 weken">
            {weeks.map((w) => (
              <li key={w.weekStart}>
                <span className="bar-label">{formatDateShort(w.weekStart)}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.round((w.eur / maxWeek) * 100)}%` }} />
                </span>
                <span className="bar-value">
                  {w.eur > 0 ? formatMoney(w.eur, 'EUR') : '–'}
                  {Object.entries(w.other).map(([c, v]) => (
                    <span key={c} className="muted">
                      {' '}
                      +{formatMoney(v, c)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ol>

          <h2>Transacties</h2>
          <ul className="list">
            {live.map((tx) => (
              <li key={tx.id} className="card row">
                <div className="row-main">
                  <span className="row-title">
                    {KIND_LABELS[tx.kind]}
                    {tx.note ? ` · ${tx.note}` : ''}
                  </span>
                  <span className="muted">
                    {formatDate(tx.date)} · {SOURCE_LABELS[tx.source]}
                  </span>
                </div>
                <span className={`row-value ${isIncome(tx.kind) ? 'positive' : 'negative'}`}>
                  {isIncome(tx.kind) ? '+' : '−'}
                  {formatMoney(tx.amount, tx.currency)}
                </span>
                <button className="btn icon" aria-label={`Verwijder ${KIND_LABELS[tx.kind]} ${formatDate(tx.date)}`} onClick={() => void remove(tx)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  )
}

function OtherStat({ other }: { other: MoneyTotals['other'] }) {
  const entries = Object.entries(other)
  if (entries.length === 0) return null
  return (
    <div className="stat">
      <dt>Andere valuta</dt>
      <dd className="small">
        {entries.map(([c, v]) => (
          <span key={c}>
            {v.income > 0 && `+${formatMoney(v.income, c)} `}
            {v.costs > 0 && `−${formatMoney(v.costs, c)} `}
          </span>
        ))}
      </dd>
    </div>
  )
}

function OtherLine({ other }: { other: MoneyTotals['other'] }) {
  const entries = Object.entries(other)
  if (entries.length === 0) return null
  return (
    <div className="muted small">
      {entries.map(([c, v]) => (
        <span key={c}>
          {v.income > 0 && `+${formatMoney(v.income, c)} `}
          {v.costs > 0 && `−${formatMoney(v.costs, c)} `}
        </span>
      ))}
    </div>
  )
}
