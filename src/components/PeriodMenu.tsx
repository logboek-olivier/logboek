import { Ellipsis, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { periodeVerwijderen } from '../domain/trips'
import { landperiodeVerwijderen } from '../domain/agenda'
import { t } from '../i18n'
import { stayMoney, stayName } from '../model/periods'
import { tripDependents } from '../model/trip-ops'
import type { StayPeriod, Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { HistoryButton } from '../screens/History'

// "⋯" bij een periode: hier, en alleen hier, staat "Periode verwijderen" (nooit naast de dagen of onderaan een
// bewerkscherm). Eerst wat er aan de periode hangt, dan de keuze: geld en dagen behouden zonder periode, of alles naar de
// prullenbak. Daarna 30 seconden ongedaan maken, en 30 dagen in Meer → Prullenbak.

type Target = { trip: Trip; stay?: undefined } | { stay: StayPeriod; trip?: undefined }

export function PeriodMenu({ store, notify, onDeleted, ...target }: Target & { store: Store; notify: Notify; onDeleted?: () => void }) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = target.trip ? target.trip.name : stayName(target.stay)
  const deps = target.trip ? tripDependents(store, target.trip) : null
  const days = deps?.legs.length ?? 0
  // Een declaratie met bedrag heeft ook een uitgave: één keer tellen.
  const money = deps ? deps.transactions.filter((tx) => !tx.claimId).length + deps.claims.length : stayMoney(store, target.stay!).length
  const people = deps?.participants.length ?? 0
  const extra = (deps?.students.length ?? 0) + (deps?.plans.length ?? 0)
  const parts = [
    days > 0 && t('trip.part.legs', { n: days }),
    money > 0 && t('trip.part.transactions', { n: money }),
    people > 0 && t('trip.part.participants', { n: people }),
    extra > 0 && t('periodMenu.part.other', { n: extra }),
  ].filter((x): x is string => !!x)

  async function remove(choice: 'behouden' | 'alles') {
    if (busy) return
    setBusy(true)
    try {
      const undo = target.trip ? await periodeVerwijderen(store, target.trip, choice) : await landperiodeVerwijderen(store, target.stay!, choice)
      setOpen(false)
      onDeleted?.()
      notify(t(choice === 'behouden' && days + money + extra > 0 ? 'periodMenu.deletedKept' : 'periodMenu.deleted', { name }), undo, { long: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn icon" aria-label={t('periodMenu.open', { name })} onClick={() => setOpen(true)}>
        <Icon icon={Ellipsis} />
      </button>
      {open && (
        <Sheet
          title={name}
          onClose={() => {
            setOpen(false)
            setAsking(false)
          }}
        >
          {!asking ? (
            <div className="stack">
              <HistoryButton store={store} notify={notify} filter={{ periodId: target.trip ? target.trip.id : target.stay!.id }} title={t('history.periodTitle', { name })} />
              <button type="button" className="btn danger" onClick={() => setAsking(true)}>
                <Icon icon={Trash2} />
                {t('periodMenu.delete')}
              </button>
            </div>
          ) : (
            <div className="stack delete-choice" role="group" aria-label={t('periodMenu.delete')}>
              <h3>{t('periodMenu.confirm', { name })}</h3>
              <p>{parts.length > 0 ? t('periodMenu.attached', { parts: parts.join(', ') }) : t('periodMenu.nothing')}</p>
              {days + money + extra > 0 && (
                <button type="button" className="btn" disabled={busy} onClick={() => void remove('behouden')}>
                  {t('periodMenu.keep')}
                </button>
              )}
              <button type="button" className="btn danger" disabled={busy} onClick={() => void remove('alles')}>
                <Icon icon={Trash2} />
                {t(parts.length > 0 ? 'periodMenu.all' : 'periodMenu.toTrash')}
              </button>
              <p className="muted small">{t('periodMenu.trashNote')}</p>
              <button type="button" className="btn link" onClick={() => setAsking(false)}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}
