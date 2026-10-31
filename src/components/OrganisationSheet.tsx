import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { LEGACY_ORGS, organisations, type OrgDef } from '../basis/organisatie'
import { instellingenOpslaan } from '../domain/instellingen'
import { t } from '../i18n'
import { newId } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Instellingen → Organisaties: voor wie Olivier werkt (naam, en een afkorting voor de teller: "SV" → "SV #3").
// Standaardsalaris, uitbetaling en de beginnummers van de teller staan per organisatie in de rijen eronder. "Eigen" en
// "Overig" bestaan altijd. Bekende organisaties (Sailing Virgins, Yacht Week) staan als voorstel: één tik voegt ze toe. Een organisatie die bij trips staat, gaat niet weg (die trips zouden hun naam kwijtraken).

export function organisationsLine(): string {
  return organisations().map((o) => o.name).join(' · ')
}

export function OrganisationsSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const [rows, setRows] = useState<OrgDef[]>(() => organisations().map((o) => ({ ...o })))
  const [busy, setBusy] = useState(false)
  const used = (id: string) => store.list('trips.json.enc').filter((x) => x.organisation === id).length
  const valid = rows.every((r) => r.name.trim().length > 0) && new Set(rows.map((r) => r.short?.trim().toUpperCase()).filter(Boolean)).size === rows.filter((r) => r.short?.trim()).length

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const clean = rows.map((r) => ({ id: r.id, name: r.name.trim().slice(0, 60), ...(r.short?.trim() ? { short: r.short.trim().slice(0, 6) } : {}) }))
      const undo = await instellingenOpslaan(store, { organisations: clean })
      onClose()
      notify(t('orgs.saved'), undo)
    } finally {
      setBusy(false)
    }
  }

  const set = (i: number, patch: Partial<OrgDef>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <Sheet title={t('orgs.title')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <p className="muted small">{t('orgs.intro')}</p>
        {rows.length === 0 && <p className="muted">{t('orgs.none')}</p>}
        {rows.map((row, i) => {
          const count = used(row.id)
          return (
            <fieldset key={row.id} className="stack-sm org-row">
              <div className="row">
                <label className="grow">
                  {t('orgs.name')}
                  <input type="text" autoComplete="off" maxLength={60} value={row.name} onChange={(e) => set(i, { name: e.target.value })} />
                </label>
                <label>
                  {t('orgs.short')}
                  <input type="text" autoComplete="off" maxLength={6} size={6} value={row.short ?? ''} onChange={(e) => set(i, { short: e.target.value })} />
                </label>
              </div>
              {count > 0 ? (
                <p className="muted small">{t('orgs.inUse', { n: count })}</p>
              ) : (
                <button type="button" className="btn link small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Icon icon={Trash2} />
                  {t('orgs.remove', { name: row.name || t('orgs.name') })}
                </button>
              )}
            </fieldset>
          )
        })}
        {LEGACY_ORGS.filter((o) => !rows.some((r) => r.id === o.id)).length > 0 && (
          <div className="row wrap org-suggestions">
            {LEGACY_ORGS.filter((o) => !rows.some((r) => r.id === o.id)).map((o) => (
              <button key={o.id} type="button" className="chip" onClick={() => setRows([...rows, { ...o }])}>
                <Icon icon={Plus} />
                {o.name} ({o.short})
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn" onClick={() => setRows([...rows, { id: `org:${newId()}`, name: '' }])}>
          <Icon icon={Plus} />
          {t('orgs.add')}
        </button>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!valid || busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
