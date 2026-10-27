import { ChevronLeft, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateRange, formatHours, formatNm, formatNumber } from '../format'
import { t } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { sailtime, type BoatInfo, type Sailtime, type SailtimeFilter } from '../model/sailtime'
import { ROLES, type Role } from '../model/types'
import type { Store } from '../storage/store'

// Zeiltijd exporteren als PDF (via de printfunctie van de telefoon), in de stijl van een RYA/ASA-logboek: per dag of
// per trip met boot, model, lengte, rol, nm, nachturen en getijdenwater, plus totalen per rol. Filter op periode en rol.

type View = 'dag' | 'trip'

function boatCell(b: BoatInfo): string {
  return [b.boat, b.model, b.lengthFt ? `${formatNumber(b.lengthFt)} ft` : ''].filter(Boolean).join(' · ')
}

export function SailingExport({ store, onBack }: { store: Store; onBack: () => void }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const [filter, setFilter] = useState<SailtimeFilter>({ from: '', to: '', role: '' })
  const [view, setView] = useState<View>('dag')
  const [printRequest, setPrintRequest] = useState(0)
  const data = sailtime(trips, legs, filter)

  useEffect(() => {
    if (printRequest > 0) window.print()
  }, [printRequest])

  return (
    <section className="stack-lg">
      <button className="btn link back-link" onClick={onBack}>
        <Icon icon={ChevronLeft} />
        {t('nav.logbook')}
      </button>
      <header className="page-header">
        <h1>{t('export.title')}</h1>
      </header>
      <div className="two">
        <label>
          {t('export.from')}
          <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        </label>
        <label>
          {t('export.to')}
          <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
        </label>
      </div>
      <label>
        {t('field.role')}
        <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value as Role | '' })}>
          <option value="">{t('export.allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </label>
      <div className="segments small" role="radiogroup" aria-label={t('export.view')}>
        {(['dag', 'trip'] as View[]).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={`segment${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
            {t(v === 'dag' ? 'export.perDay' : 'export.perTrip')}
          </button>
        ))}
      </div>
      <button className="btn primary" disabled={data.days.length === 0} onClick={() => setPrintRequest((n) => n + 1)}>
        <Icon icon={Printer} />
        {t('export.print')}
      </button>
      <p className="muted small">{t('export.printHint')}</p>
      {data.days.length === 0 ? <p className="muted">{t('export.empty')}</p> : <SailtimeTables data={data} view={view} />}
      {printRequest > 0 &&
        createPortal(
          <div className="print-root sailtime-print">
            <h1>{t('export.printTitle')}</h1>
            <p>
              {[
                filter.from || filter.to ? formatDateRange(filter.from || data.days[0]!.date, filter.to || data.days.at(-1)!.date) : formatDateRange(data.days[0]?.date ?? '', data.days.at(-1)?.date ?? ''),
                filter.role ? roleLabel(filter.role) : t('export.allRoles'),
              ].join(' · ')}
            </p>
            <SailtimeTables data={data} view={view} />
          </div>,
          document.body,
        )}
    </section>
  )
}

function SailtimeTables({ data, view }: { data: Sailtime; view: View }) {
  return (
    <>
      <div className="table-scroll">
        {view === 'dag' ? (
          <table className="sailtime">
            <thead>
              <tr>
                <th>{t('field.date')}</th>
                <th>{t('export.boat')}</th>
                <th>{t('field.role')}</th>
                <th>{t('export.route')}</th>
                <th className="num">nm</th>
                <th className="num">{t('export.tidal')}</th>
                <th className="num">{t('export.night')}</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.date)}</td>
                  <td>{boatCell(d)}</td>
                  <td>{roleLabel(d.role)}</td>
                  <td>{d.route}</td>
                  <td className="num">{formatNumber(d.nm)}</td>
                  <td className="num">{d.tidal ? formatNumber(d.tidal) : ''}</td>
                  <td className="num">{d.night ? formatHours(d.night) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="sailtime">
            <thead>
              <tr>
                <th>{t('export.trip')}</th>
                <th>{t('export.dates')}</th>
                <th>{t('export.boat')}</th>
                <th>{t('field.role')}</th>
                <th className="num">{t('export.days')}</th>
                <th className="num">nm</th>
                <th className="num">{t('export.tidal')}</th>
                <th className="num">{t('export.night')}</th>
              </tr>
            </thead>
            <tbody>
              {data.trips.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{formatDateRange(r.start, r.end)}</td>
                  <td>{boatCell(r)}</td>
                  <td>{r.roles.map((role) => roleLabel(role)).join(', ')}</td>
                  <td className="num">{r.days}</td>
                  <td className="num">{formatNumber(r.nm)}</td>
                  <td className="num">{r.tidal ? formatNumber(r.tidal) : ''}</td>
                  <td className="num">{r.night ? formatHours(r.night) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="table-scroll">
        <table className="sailtime totals">
          <caption>{t('export.totals')}</caption>
          <thead>
            <tr>
              <th>{t('field.role')}</th>
              <th className="num">{t('export.days')}</th>
              <th className="num">nm</th>
              <th className="num">{t('export.tidal')}</th>
              <th className="num">{t('export.night')}</th>
            </tr>
          </thead>
          <tbody>
            {data.totals.map((r) => (
              <tr key={r.role}>
                <td>{roleLabel(r.role)}</td>
                <td className="num">{r.days}</td>
                <td className="num">{formatNm(r.nm)}</td>
                <td className="num">{formatNm(r.tidal)}</td>
                <td className="num">{formatHours(r.night)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>{t('export.total')}</td>
              <td className="num">{data.total.days}</td>
              <td className="num">{formatNm(data.total.nm)}</td>
              <td className="num">{formatNm(data.total.tidal)}</td>
              <td className="num">{formatHours(data.total.night)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
