import { Coins, Receipt, Trash2, Wallet } from 'lucide-react'
import { BarChart } from '../components/BarChart'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { active } from '../model/derive'
import { isIncome, monthSeries, perMonth, perSource, tipsPerWeek, totals, type MoneyTotals } from '../model/money'
import { KIND_LABELS, SOURCE_LABELS, todayIso, type Transaction } from '../model/types'
import type { Store } from '../storage/store'

// Geld: zeilgeld per maand, per bron, fooi per week (12 weken), lijst per maand met verwijderen. Geen netto waarde.

export function Money({ store, onDone, onAdd }: { store: Store; onDone: (message: string) => void; onAdd: () => void }) {
  const transactions = useCollection(store, 'transactions.json.enc')
  const live = active(transactions).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1))
  const today = todayIso()
  const all = totals(live)
  const months = perMonth(live)
  const sources = perSource(live)
  const weeks = tipsPerWeek(live, today)
  const series = monthSeries(live, today)
  const weekOther = mergeOther(weeks.map((w) => w.other))

  async function remove(tx: Transaction) {
    const label = `${KIND_LABELS[tx.kind]} van ${formatMoney(tx.amount, tx.currency)} op ${formatDate(tx.date)} verwijderen?`
    if (!window.confirm(label)) return
    await store.remove('transactions.json.enc', tx.id)
    void store.sync()
    onDone('Verwijderd')
  }

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>Geld</h1>
      </header>
      {live.length === 0 && (
        <Empty
          icon={Wallet}
          action={
            <button className="btn primary" onClick={onAdd}>
              Fooi toevoegen
            </button>
          }
        >
          Nog geen zeilgeld. Een fooi of kosten invoeren kost een paar seconden.
        </Empty>
      )}
      {live.length > 0 && (
        <>
          <dl className="grid">
            <Stat label="Saldo" value={formatMoney(all.balanceEur, 'EUR')} tone={all.balanceEur >= 0 ? 'positive' : 'negative'} hero />
            <Stat label="Inkomsten" value={formatMoney(all.incomeEur, 'EUR')} />
            <Stat label="Kosten" value={formatMoney(all.costsEur, 'EUR')} />
            <OtherStat other={all.other} />
          </dl>

          <div className="section card card-body">
            <div className="section-head">
              <h2>Fooi per week</h2>
              <span className="muted">12 weken</span>
            </div>
            <BarChart
              label={`Fooi per week, laatste 12 weken: ${weeks.map((w) => `${formatDateShort(w.weekStart)} ${formatMoney(w.eur, 'EUR')}`).join(', ')}`}
              groups={weeks.map((w) => ({ key: w.weekStart, label: formatDateShort(w.weekStart).replace('.', ''), values: [w.eur] }))}
              format={(n) => formatMoneyShort(n)}
              labelEvery={3}
            />
            {Object.keys(weekOther).length > 0 && (
              <p className="muted small">Niet in de grafiek: {Object.entries(weekOther).map(([c, v]) => formatMoney(v, c)).join(', ')}</p>
            )}
          </div>

          <div className="section card card-body">
            <div className="section-head">
              <h2>Per maand</h2>
              <span className="muted">EUR</span>
            </div>
            <BarChart
              label={`Inkomsten en kosten per maand: ${series.map((m) => `${formatMonth(m.month)} in ${formatMoney(m.incomeEur, 'EUR')}, uit ${formatMoney(m.costsEur, 'EUR')}`).join('; ')}`}
              groups={series.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.incomeEur, m.costsEur] }))}
              format={(n) => formatMoneyShort(n)}
              labelEvery={2}
            />
            <ul className="legend">
              <li>
                <span className="swatch" /> Inkomsten
              </li>
              <li>
                <span className="swatch s2" /> Kosten
              </li>
            </ul>
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
                      {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                      <OtherLine other={m.other} />
                    </td>
                    <td className="num">{formatMoney(m.incomeEur, 'EUR')}</td>
                    <td className="num">{formatMoney(m.costsEur, 'EUR')}</td>
                    <td className={`num ${m.balanceEur >= 0 ? 'positive' : 'negative'}`}>{formatMoney(m.balanceEur, 'EUR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section">
            <h2>Per bron</h2>
            <ul className="rows">
              {sources.map((s) => (
                <li key={s.source} className="row-item">
                  <div className="row-main">
                    <span className="row-title">{SOURCE_LABELS[s.source]}</span>
                    <OtherLine other={s.other} />
                  </div>
                  <span className="row-value">
                    <span className="positive">+{formatMoney(s.incomeEur, 'EUR')}</span>
                    <br />
                    <span className="muted">−{formatMoney(s.costsEur, 'EUR')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h2>Transacties</h2>
            {months.map((m) => (
              <div key={m.month} className="group">
                <h3 className="group-head">
                  <span>{formatMonth(m.month)}</span>
                  <span className="num">{formatMoney(m.balanceEur, 'EUR')}</span>
                </h3>
                <ul className="rows">
                  {live
                    .filter((tx) => tx.date.startsWith(m.month))
                    .map((tx) => (
                      <li key={tx.id} className="row-item tx">
                        <span className={`row-icon${isIncome(tx.kind) ? '' : ' cost'}`}>
                          <Icon icon={isIncome(tx.kind) ? Coins : Receipt} />
                        </span>
                        <div className="row-main">
                          <span className="row-title">{tx.note ?? KIND_LABELS[tx.kind]}</span>
                          <span className="muted">
                            {formatDateShort(tx.date)}
                            {tx.note ? ` · ${KIND_LABELS[tx.kind]}` : ''} · {SOURCE_LABELS[tx.source]}
                          </span>
                        </div>
                        <span className={`row-value ${isIncome(tx.kind) ? 'positive' : ''}`}>
                          {isIncome(tx.kind) ? '+' : '−'}
                          {formatMoney(tx.amount, tx.currency)}
                        </span>
                        <button
                          className="btn icon"
                          aria-label={`Verwijder ${KIND_LABELS[tx.kind]} ${formatDate(tx.date)}`}
                          onClick={() => void remove(tx)}
                        >
                          <Icon icon={Trash2} />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function mergeOther(list: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const other of list) for (const [c, v] of Object.entries(other)) out[c] = (out[c] ?? 0) + v
  return out
}

function Stat({ label, value, tone, hero = false }: { label: string; value: string; tone?: 'positive' | 'negative'; hero?: boolean }) {
  return (
    <div className={`stat${hero ? ' hero wide' : ''}`}>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  )
}

function OtherStat({ other }: { other: MoneyTotals['other'] }) {
  const entries = Object.entries(other)
  if (entries.length === 0) return null
  return (
    <div className="stat wide">
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
