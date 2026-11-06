import { Send, X } from 'lucide-react'
import { Suspense, useState } from 'react'
import { todayIso } from '../basis/datum'
import { berichtMarkeren } from '../domain/berichten'
import { t } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { messageReminders, type MessageReminder } from '../model/messages'
import { currentSettings } from '../model/settings'
import type { Store } from '../storage/store'
import { lazyComponent } from '../lazy'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Vandaag: "Introductie sturen voor <trip>" vanaf X dagen vóór de start en "Afsluiting sturen voor <trip>" vanaf de
// laatste dag (src/model/messages.ts). Weg na "Verstuurd" of "Niet nodig". Het blad om het bericht te maken laadt pas
// bij een tik (Vandaag opent snel).

const MessageSheet = lazyComponent(() => import('./MessageSheets').then((m) => m.MessageSheet))

export function MessageReminders({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const [open, setOpen] = useState<MessageReminder | null>(null)
  const [busy, setBusy] = useState(false)
  const reminders = messageReminders(trips, legs, settings, todayIso()).slice(0, 3)
  if (reminders.length === 0 && !open) return null
  return (
    <>
      {reminders.map((r) => (
        <div key={`${r.trip.id}-${r.kind}`} className="card card-body stack-sm msg-reminder">
          <p className="row">
            <Icon icon={Send} />
            <span className="grow">{t(`msg.remind.${r.kind}`, { trip: nameWithCounter(r.trip, counters.get(r.trip.id)) })}</span>
          </p>
          <div className="row wrap">
            <button type="button" className="btn small primary" onClick={() => setOpen(r)}>
              {t('msg.open')}
            </button>
            <button
              type="button"
              className="btn small quiet"
              disabled={busy}
              onClick={async () => {
                if (busy) return
                setBusy(true)
                try {
                  const undo = await berichtMarkeren(store, r.trip.id, r.kind, 'niet-nodig', todayIso())
                  notify(t('msg.markedNotNeeded'), undo)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Icon icon={X} />
              {t('msg.notNeeded')}
            </button>
          </div>
        </div>
      ))}
      {open && (
        <Suspense fallback={null}>
          <MessageSheet store={store} notify={notify} trip={open.trip} kind={{ kind: open.kind }} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </>
  )
}
