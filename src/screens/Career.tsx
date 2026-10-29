import { Briefcase, FolderKanban, Plus, Trash2, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { NoteField } from '../components/NoteField'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { ViewRows } from '../components/Views'
import { formatDate } from '../format'
import { t, type MessageKey } from '../i18n'
import { applications, cleanApplication, cleanContact, cleanProject, contacts, isOpen, projects, saveCareer, sortApplications, type ApplicationInput, type ContactInput, type ProjectInput } from '../model/career'
import { deleteCareerRecord } from '../model/edit'
import { APPLICATION_STATUSES, PROJECT_STATUSES, type Application, type CareerRecord, type Project } from '../model/types'
import type { Store } from '../storage/store'
import { dueLabel } from './Deadlines'

// Meer → Carrière: sollicitaties met de volgende actie (die staat ook bij de termijnen), het netwerk (alleen voornaam, rol
// en waar ontmoet) en de status van andere projecten. Tik = bekijken; bewerken via het potlood; verwijderen met
// ongedaan maken.

const appStatus = (s: Application['status']) => t(`career.status.${s}` as MessageKey)
const projectStatus = (s: Project['status']) => t(`career.project.${s}` as MessageKey)

type Open = { kind: 'view' | 'edit'; record: CareerRecord } | { kind: 'new'; type: CareerRecord['kind'] } | null

export function Career({ store, notify }: { store: Store; notify: Notify }) {
  const records = useCollection(store, 'career.json.enc')
  const [open, setOpen] = useState<Open>(null)
  const apps = sortApplications(applications(records))
  const people = contacts(records)
  const own = projects(records).sort((a, b) => PROJECT_STATUSES.indexOf(a.status) - PROJECT_STATUSES.indexOf(b.status) || a.name.localeCompare(b.name))
  const close = () => setOpen(null)

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('career.screen')}</h1>
      </header>

      <div className="section">
        <h2>{t('career.applications')}</h2>
        {apps.length === 0 ? (
          <Empty icon={Briefcase}>{t('career.applicationsEmpty')}</Empty>
        ) : (
          <ul className="rows">
            {apps.map((a) => (
              <li key={a.id}>
                <button type="button" className="row-button" onClick={() => setOpen({ kind: 'view', record: a })}>
                  <span className="row-main">
                    <span className="row-title">{[a.company, a.role].filter(Boolean).join(' · ')}</span>
                    <span className="muted small">
                      {[appStatus(a.status), isOpen(a.status) && a.nextAction ? a.nextAction : '', isOpen(a.status) && a.nextDate ? `${formatDate(a.nextDate)} (${dueLabel({ date: a.nextDate, kind: 'deadline' })})` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn" onClick={() => setOpen({ kind: 'new', type: 'sollicitatie' })}>
          <Icon icon={Plus} />
          {t('career.newApplication')}
        </button>
      </div>

      <div className="section">
        <h2>{t('career.network')}</h2>
        {people.length === 0 ? (
          <Empty icon={Users}>{t('career.networkEmpty')}</Empty>
        ) : (
          <ul className="rows">
            {people.map((c) => (
              <li key={c.id}>
                <button type="button" className="row-button" onClick={() => setOpen({ kind: 'view', record: c })}>
                  <span className="row-main">
                    <span className="row-title">{c.firstName}</span>
                    <span className="muted small">{[c.role, c.metAt].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn" onClick={() => setOpen({ kind: 'new', type: 'contact' })}>
          <Icon icon={Plus} />
          {t('career.newContact')}
        </button>
      </div>

      <div className="section">
        <h2>{t('career.projects')}</h2>
        {own.length === 0 ? (
          <Empty icon={FolderKanban}>{t('career.projectsEmpty')}</Empty>
        ) : (
          <ul className="rows">
            {own.map((p) => (
              <li key={p.id}>
                <button type="button" className="row-button" onClick={() => setOpen({ kind: 'view', record: p })}>
                  <span className="row-main">
                    <span className="row-title">{p.name}</span>
                    <span className="muted small">{[projectStatus(p.status), p.nextStep].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn" onClick={() => setOpen({ kind: 'new', type: 'project' })}>
          <Icon icon={Plus} />
          {t('career.newProject')}
        </button>
      </div>

      {open?.kind === 'view' && <CareerView store={store} record={open.record} onClose={close} onEdit={() => setOpen({ kind: 'edit', record: open.record })} />}
      {open?.kind === 'edit' && <CareerSheet store={store} type={open.record.kind} record={open.record} notify={notify} onClose={close} />}
      {open?.kind === 'new' && <CareerSheet store={store} type={open.type} record={null} notify={notify} onClose={close} />}
    </section>
  )
}

function CareerView({ store, record, onClose, onEdit }: { store: Store; record: CareerRecord; onClose: () => void; onEdit: () => void }) {
  const current = useCollection(store, 'career.json.enc').find((r) => r.id === record.id) ?? record
  const title = current.kind === 'sollicitatie' ? current.company : current.kind === 'contact' ? current.firstName : current.name
  return (
    <Sheet title={title} onClose={onClose} onEdit={onEdit}>
      <div className="stack view">
        {current.kind === 'sollicitatie' && (
          <ViewRows
            rows={[
              [t('career.role'), current.role],
              [t('career.status'), appStatus(current.status)],
              [t('career.nextAction'), current.nextAction],
              [t('career.nextDate'), current.nextDate && formatDate(current.nextDate)],
              [t('field.note'), current.note],
            ]}
          />
        )}
        {current.kind === 'contact' && (
          <ViewRows
            rows={[
              [t('career.contactRole'), current.role],
              [t('career.metAt'), current.metAt],
            ]}
          />
        )}
        {current.kind === 'project' && (
          <ViewRows
            rows={[
              [t('career.status'), projectStatus(current.status)],
              [t('career.nextStep'), current.nextStep],
            ]}
          />
        )}
      </div>
    </Sheet>
  )
}

function CareerSheet({ store, type, record, notify, onClose }: { store: Store; type: CareerRecord['kind']; record: CareerRecord | null; notify: Notify; onClose: () => void }) {
  const app = record?.kind === 'sollicitatie' ? record : null
  const contact = record?.kind === 'contact' ? record : null
  const project = record?.kind === 'project' ? record : null
  const [a, setA] = useState<ApplicationInput>({ company: app?.company ?? '', role: app?.role ?? '', status: app?.status ?? 'gesolliciteerd', nextAction: app?.nextAction ?? '', nextDate: app?.nextDate ?? '', note: app?.note ?? '' })
  const [c, setC] = useState<ContactInput>({ firstName: contact?.firstName ?? '', role: contact?.role ?? '', metAt: contact?.metAt ?? '' })
  const [p, setP] = useState<ProjectInput>({ name: project?.name ?? '', status: project?.status ?? 'bezig', nextStep: project?.nextStep ?? '' })
  const [busy, setBusy] = useState(false)
  const ok = type === 'sollicitatie' ? a.company.trim() !== '' : type === 'contact' ? c.firstName.trim() !== '' : p.name.trim() !== ''
  const titles: Record<CareerRecord['kind'], [MessageKey, MessageKey]> = {
    sollicitatie: ['career.newApplication', 'career.editApplication'],
    contact: ['career.newContact', 'career.editContact'],
    project: ['career.newProject', 'career.editProject'],
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    await saveCareer(store, record?.id ?? null, type === 'sollicitatie' ? cleanApplication(a) : type === 'contact' ? cleanContact(c) : cleanProject(p))
    onClose()
    notify(t('career.saved'))
  }

  async function remove() {
    if (!record) return
    const undo = await deleteCareerRecord(store, record)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t(titles[type][record ? 1 : 0])} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {type === 'sollicitatie' && (
          <>
            <div className="two">
              <label>
                {t('career.company')}
                <input type="text" autoComplete="off" autoCapitalize="words" maxLength={80} value={a.company} onChange={(e) => setA({ ...a, company: e.target.value })} />
              </label>
              <label>
                {t('career.role')}
                <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} />
              </label>
            </div>
            <label>
              {t('career.status')}
              <select value={a.status} onChange={(e) => setA({ ...a, status: e.target.value as Application['status'] })}>
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {appStatus(s)}
                  </option>
                ))}
              </select>
            </label>
            <div className="two">
              <label>
                {t('career.nextAction')}
                <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={120} placeholder={t('career.nextActionPlaceholder')} value={a.nextAction} onChange={(e) => setA({ ...a, nextAction: e.target.value })} />
              </label>
              <label>
                {t('career.nextDate')}
                <input type="date" value={a.nextDate} onChange={(e) => setA({ ...a, nextDate: e.target.value })} />
              </label>
            </div>
            <NoteField label={t('field.note')} value={a.note} onChange={(note) => setA({ ...a, note })} maxLength={2000} />
          </>
        )}
        {type === 'contact' && (
          <>
            <label>
              {t('career.firstName')}
              <input type="text" autoComplete="off" autoCapitalize="words" maxLength={40} value={c.firstName} onChange={(e) => setC({ ...c, firstName: e.target.value })} />
            </label>
            <p className="muted small">{t('career.firstNameHint')}</p>
            <label>
              {t('career.contactRole')}
              <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} />
            </label>
            <label>
              {t('career.metAt')}
              <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={120} value={c.metAt} onChange={(e) => setC({ ...c, metAt: e.target.value })} />
            </label>
          </>
        )}
        {type === 'project' && (
          <>
            <label>
              {t('career.projectName')}
              <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={80} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </label>
            <div className="type-buttons" role="radiogroup" aria-label={t('career.status')}>
              {PROJECT_STATUSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={p.status === s} className={`chip${p.status === s ? ' active' : ''}`} onClick={() => setP({ ...p, status: s })}>
                  {projectStatus(s)}
                </button>
              ))}
            </div>
            <label>
              {t('career.nextStep')}
              <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={160} value={p.nextStep} onChange={(e) => setP({ ...p, nextStep: e.target.value })} />
            </label>
          </>
        )}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {t('common.save')}
          </button>
          {record && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
