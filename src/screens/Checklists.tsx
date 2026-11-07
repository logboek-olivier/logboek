import { ListChecks, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { ChecklistTemplateSheet, NewChecklistButton, tripTypesText } from '../components/ChecklistSheet'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { checklistTerugzetten, checklistToevoegen } from '../domain/trips'
import { t, useLang } from '../i18n'
import { effectiveChecklists, hiddenSeedChecklists } from '../model/checklists'
import { localized } from '../model/curricula'
import type { Store } from '../storage/store'
import { useCollection } from '../components/useCollection'

// Meer → Checklists: alle vaste checklists (meegeleverd en eigen) op één plek. Tik = bekijken, potlood = bewerken (naam,
// bij welke trips, punten en hun volgorde, verwijderen). Verborgen meegeleverde lijsten zijn terug te zetten.

export function Checklists({ store, notify }: { store: Store; notify: Notify }) {
  const lang = useLang()
  const stored = useCollection(store, 'checklists.json.enc')
  const lists = effectiveChecklists(stored)
  const hidden = hiddenSeedChecklists(stored)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = lists.find((l) => l.id === openId)
  return (
    <section className="stack">
      <header className="page-header">
        <h1>{t('checklist.screen')}</h1>
      </header>
      <ul className="rows">
        {lists.map((list) => (
          <li key={list.id}>
            <button className="row-button" onClick={() => setOpenId(list.id)}>
              <Icon icon={ListChecks} />
              <span className="row-main">
                <span>{localized(list.title, lang)}</span>
                <span className="muted small">{tripTypesText(list.tripTypes)}</span>
              </span>
              <span className="row-value small">{t('checklist.itemCount', { n: list.items.length })}</span>
            </button>
          </li>
        ))}
      </ul>
      <NewChecklistButton onAdd={() => void checklistToevoegen(store, t('checklist.newTitle'), null).then(({ result }) => setOpenId(result.id))} />
      {hidden.length > 0 && (
        <div className="section">
          <h2>{t('checklist.hidden')}</h2>
          <ul className="rows">
            {hidden.map((list) => (
              <li key={list.id} className="row wrap">
                <span className="grow">{localized(list.title, lang)}</span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    void checklistTerugzetten(store, list.id).then((undo) => {
                      notify(t('toast.saved'), undo)
                    })
                  }
                >
                  <Icon icon={RotateCcw} />
                  {t('checklist.restore')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <ChecklistTemplateSheet key={open.id} store={store} list={open} notify={notify} onClose={() => setOpenId(null)} />}
    </section>
  )
}
