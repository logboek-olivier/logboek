import { MessageTemplatesView } from '../components/MessageSheets'
import type { Notify } from '../components/EditSheets'
import { t } from '../i18n'
import type { Store } from '../storage/store'

// Meer → Berichten: de sjablonen voor introductie, afsluiting en eigen soorten berichten (src/model/messages.ts).

export function Messages({ store, notify }: { store: Store; notify: Notify }) {
  return (
    <section className="stack">
      <header className="page-header">
        <h1>{t('msg.title')}</h1>
      </header>
      <MessageTemplatesView store={store} notify={notify} />
    </section>
  )
}
