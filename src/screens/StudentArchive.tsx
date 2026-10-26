import type { Notify } from '../components/EditSheets'
import { useCollection } from '../components/useCollection'
import { t } from '../i18n'
import { effectiveCurricula } from '../model/curricula'
import type { Store } from '../storage/store'
import { StudentsView } from './Students'

// Studentenarchief (onder Meer): studenten zonder week (bijvoorbeeld van vóór de weken) en gearchiveerde studenten.
// Na 12 maanden zonder activiteit archiveert de app automatisch; het archief is te wissen (regel 14).

export function StudentArchive({ store, notify }: { store: Store; notify: Notify }) {
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.studentArchive')}</h1>
      </header>
      <StudentsView store={store} notify={notify} curricula={curricula} scope={{ kind: 'noWeek' }} />
    </section>
  )
}
