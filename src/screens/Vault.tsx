import { FileText, Image as ImageIcon, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { AddDocumentSheet, DocumentView, categoryLabel } from '../components/DocumentSheets'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate } from '../format'
import { t } from '../i18n'
import { isImage, VAULT_REVIEWED } from '../model/documents'
import { DOCUMENT_CATEGORIES, type VaultDocument } from '../model/types'
import type { Store } from '../storage/store'
import { dueLabel } from './Deadlines'

// Meer → Kluis: documenten per categorie, met de vervaldatum erbij (die staat ook bij de termijnen). Tik = bekijken;
// bewerken via het potlood. Niet in de demo. Tot het rapport van de beveiligingsreview is goedgekeurd: alleen
// nepdocumenten (zie VAULT_REVIEWED).

export function Vault({ store, notify }: { store: Store; notify: Notify }) {
  const documents = useCollection(store, 'documents/index.json.enc').filter((d) => d.deletedAt === null)
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState<VaultDocument | null>(null)
  const groups = DOCUMENT_CATEGORIES.map((category) => ({ category, items: documents.filter((d) => d.category === category).sort((a, b) => a.title.localeCompare(b.title)) })).filter((g) => g.items.length > 0)

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('vault.screen')}</h1>
      </header>
      {!VAULT_REVIEWED && (
        <div className="notice" role="note">
          <Icon icon={Lock} />
          <span>{t('vault.testPhase')}</span>
        </div>
      )}
      {groups.length === 0 ? (
        <Empty icon={FileText}>{t('vault.empty')}</Empty>
      ) : (
        groups.map((group) => (
          <div key={group.category} className="section">
            <h2>{categoryLabel(group.category)}</h2>
            <ul className="rows">
              {group.items.map((d) => (
                <li key={d.id}>
                  <button type="button" className="row-button" onClick={() => setViewing(d)}>
                    <Icon icon={isImage(d.mime) ? ImageIcon : FileText} />
                    <span className="row-main">
                      <span className="row-title">{d.title}</span>
                      {d.expiresAt && <span className="muted small">{`${t('vault.expiresOn', { date: formatDate(d.expiresAt) })} · ${dueLabel({ date: d.expiresAt, kind: 'vervalt' })}`}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      <button type="button" className="btn primary" onClick={() => setAdding(true)}>
        <Icon icon={Plus} />
        {t('vault.add')}
      </button>
      {groups.length > 0 && <p className="muted small">{t('vault.deleteNote')}</p>}
      {adding && <AddDocumentSheet store={store} notify={notify} onClose={() => setAdding(false)} />}
      {viewing && <DocumentView key={viewing.id} store={store} document={viewing} notify={notify} onClose={() => setViewing(null)} />}
    </section>
  )
}
