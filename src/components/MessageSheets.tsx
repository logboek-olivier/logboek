import { Check, ClipboardCopy, Plus, Send, Share2, Trash2, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { organisationOfTrip, organisations } from '../basis/organisatie'
import { todayIso } from '../basis/datum'
import { berichtMarkeren, berichtVeldZetten, sjabloonOpslaan, sjabloonVerwijderen } from '../domain/berichten'
import { formatDate } from '../format'
import { getLang, t, type Lang } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import {
  effectiveTemplates,
  fillTemplate,
  isFieldToken,
  kindLabel,
  messageKinds,
  messageValues,
  MAX_TEMPLATE_LENGTH,
  templatesFor,
  textForDisplay,
  tokenName,
  TOKENS,
  type MessageKindInfo,
  type Token,
} from '../model/messages'
import { currentSettings } from '../model/settings'
import { WEEK_TYPES, type MessageField, type MessageTemplate, type Trip, type WeekType } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Berichtengenerator: een sjabloon bewerken (Meer → Berichten) en een bericht maken voor een trip (het blok Berichten
// op de trip en de herinnering op Vandaag). Delen of kopiëren; de app verstuurt zelf niets en bewaart de tekst niet.

const LANGS: readonly Lang[] = ['en', 'nl']

/** Kort: taal · organisatie · soort trip ("Engels · Yacht Week · Skipper charter"), of "Algemeen". */
export function templateLine(template: MessageTemplate): string {
  const parts = [t(template.lang === 'nl' ? 'lang.nl' : 'lang.en')]
  if (template.organisation) parts.push(organisationLabel(template.organisation))
  if (template.tripType) parts.push(t(`weekType.${template.tripType}`))
  if (!template.organisation && !template.tripType) parts.push(t('msg.general'))
  return parts.join(' · ')
}

/** Sjabloon bewerken of nieuw: taal, organisatie, soort trip en de tekst met invulvelden als chips. */
export function TemplateSheet({
  store,
  notify,
  template,
  kind,
  onClose,
}: {
  store: Store
  notify: Notify
  /** null = nieuw sjabloon voor `kind`. */
  template: MessageTemplate | null
  kind: MessageKindInfo
  onClose: () => void
}) {
  const uiLang = getLang()
  const [lang, setLang] = useState<Lang>(template?.lang ?? 'en')
  const [organisation, setOrganisation] = useState(template?.organisation ?? '')
  const [tripType, setTripType] = useState<WeekType | ''>(template?.tripType ?? '')
  const [kindName, setKindName] = useState(kind.name ?? '')
  const [text, setText] = useState(template ? textForDisplay(template.text, uiLang) : '')
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const cursor = useRef<number | null>(null)
  const custom = !['introductie', 'afsluiting'].includes(kind.kind)
  const ok = text.trim() !== '' && (!custom || kindName.trim() !== '')

  function insert(token: Token) {
    const el = area.current
    const piece = `{${tokenName(token, uiLang)}}`
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + piece + text.slice(end)
    cursor.current = start + piece.length
    setText(next)
  }
  // De cursor direct na het ingevoegde veld, meteen na het tekenen (vóór de volgende toets).
  useLayoutEffect(() => {
    const el = area.current
    if (cursor.current === null || !el) return
    el.focus()
    el.setSelectionRange(cursor.current, cursor.current)
    cursor.current = null
  }, [text])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      const { undo } = await sjabloonOpslaan(store, template?.id ?? null, {
        kind: kind.kind,
        ...(custom ? { kindName } : {}),
        lang,
        ...(organisation ? { organisation } : {}),
        ...(tripType ? { tripType } : {}),
        text,
      })
      onClose()
      notify(t('msg.saved'), undo)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!template) return
    const undo = await sjabloonVerwijderen(store, template.id)
    onClose()
    notify(t('msg.deleted'), undo)
  }

  return (
    <Sheet title={template ? t('msg.editTemplate') : t('msg.newTemplate')} kicker={kindLabel(kind, uiLang)} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        {custom && (
          <label>
            {t('msg.kindName')}
            <input type="text" autoComplete="off" maxLength={60} value={kindName} onChange={(e) => setKindName(e.target.value)} />
          </label>
        )}
        <div className="type-buttons" role="radiogroup" aria-label={t('msg.lang')}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className={`chip${lang === l ? ' active' : ''}`} onClick={() => setLang(l)}>
              {t(l === 'nl' ? 'lang.nl' : 'lang.en')}
            </button>
          ))}
        </div>
        <div className="two">
          <label>
            {t('msg.organisation')}
            <select value={organisation} onChange={(e) => setOrganisation(e.target.value)}>
              <option value="">{t('msg.anyOrg')}</option>
              {organisations().map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('msg.tripType')}
            <select value={tripType} onChange={(e) => setTripType(e.target.value as WeekType | '')}>
              <option value="">{t('msg.anyType')}</option>
              {WEEK_TYPES.map((w) => (
                <option key={w} value={w}>
                  {t(`weekType.${w}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="stack-sm">
          <span className="label">{t('msg.insert')}</span>
          <div className="type-buttons msg-tokens">
            {TOKENS.map((token) => (
              <button key={token} type="button" className="chip small" onClick={() => insert(token)}>
                {tokenName(token, uiLang)}
              </button>
            ))}
          </div>
        </div>
        <label>
          {t('msg.text')}
          <textarea ref={area} className="msg-text" rows={12} maxLength={MAX_TEMPLATE_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {t('common.save')}
          </button>
          {template && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

/** Een veld van het bericht voor deze trip invullen (wordt ook de standaard van de organisatie). */
function FieldSheet({ store, notify, trip, field, onClose }: { store: Store; notify: Notify; trip: Trip; field: MessageField; onClose: () => void }) {
  const [value, setValue] = useState(trip.messageFields?.[field] ?? '')
  const label = t(`msgField.${field}`)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    const undo = await berichtVeldZetten(store, trip.id, field, value)
    onClose()
    notify(t('msg.fieldSaved', { field: label }), undo)
  }
  return (
    <Sheet title={t('msg.fillTitle', { field: label })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <label>
          {label}
          <input type="text" autoComplete="off" maxLength={120} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!value.trim()}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

/**
 * Een bericht maken voor een trip: het sjabloon ingevuld, ontbrekende gegevens gemarkeerd (een tik vult een veld in),
 * pas als alles er is de tekst (voor dit ene bericht aan te passen), Delen en Kopiëren, en daarna "Verstuurd".
 */
export function MessageSheet({ store, notify, trip: given, kind, onClose }: { store: Store; notify: Notify; trip: Trip; kind: MessageKindInfo; onClose: () => void }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const templates = effectiveTemplates(useCollection(store, 'templates.json.enc'))
  const trip = trips.find((x) => x.id === given.id) ?? given
  const options = templatesFor(templates, kind.kind, organisationOfTrip(trip), trip.type)
  const [chosen, setChosen] = useState<string | null>(null)
  const template = options.find((o) => o.id === chosen) ?? options[0] ?? null
  const [filling, setFilling] = useState<MessageField | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const [handedOver, setHandedOver] = useState(false)
  const ctx = { legs, places, settings }
  const filled = template ? fillTemplate(template, messageValues(trip, ctx, template.lang)) : null
  const text = filled?.text === null || !filled ? null : (edited ?? filled.text)
  const uiLang = getLang()

  async function share() {
    if (text === null) return
    try {
      if (navigator.share) {
        await navigator.share({ text })
        setHandedOver(true)
        return
      }
      await navigator.clipboard.writeText(text)
      setHandedOver(true)
      notify(t('msg.copied'))
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      notify(t('plan.shareFailed'))
    }
  }

  async function copy() {
    if (text === null) return
    try {
      await navigator.clipboard.writeText(text)
      setHandedOver(true)
      notify(t('msg.copied'))
    } catch {
      notify(t('plan.shareFailed'))
    }
  }

  async function mark(status: 'verstuurd' | 'niet-nodig') {
    const undo = await berichtMarkeren(store, trip.id, kind.kind, status, todayIso())
    onClose()
    notify(t(status === 'verstuurd' ? 'msg.markedSent' : 'msg.markedNotNeeded'), undo)
  }

  return (
    <Sheet title={kindLabel(kind, uiLang)} kicker={trip.name} onClose={onClose}>
      <div className="stack msg-sheet">
        {options.length > 1 && (
          <div className="type-buttons" role="radiogroup" aria-label={t('msg.chooseTemplate')}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={template?.id === o.id}
                className={`chip${template?.id === o.id ? ' active' : ''}`}
                onClick={() => {
                  setChosen(o.id)
                  setEdited(null)
                }}
              >
                {templateLine(o)}
              </button>
            ))}
          </div>
        )}
        {!template && <p className="muted">{t('msg.noTemplate')}</p>}
        {filled && filled.missing.length > 0 && (
          <>
            <ul className="plain-list stack-sm msg-missing">
              {filled.missing.map((token) => (
                <li key={token} className="notice">
                  {isFieldToken(token) ? (
                    <>
                      <span className="grow">{t('msg.missing', { field: t(`msgField.${token}`) })}</span>
                      <button type="button" className="btn small primary" onClick={() => setFilling(token)}>
                        {t('msg.fill')}
                      </button>
                    </>
                  ) : (
                    <span className="grow">{t('msg.missingTrip', { field: capitalise(tokenName(token, uiLang)) })}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="msg-preview" aria-label={t('msg.text')}>
              {filled.parts.map((part, i) =>
                'text' in part ? (
                  <span key={i}>{part.text}</span>
                ) : (
                  <mark key={i} className="msg-gap">
                    {tokenName(part.missing, template!.lang)}
                  </mark>
                ),
              )}
            </p>
          </>
        )}
        {text !== null && (
          <>
            <label>
              {t('msg.editBefore')}
              <textarea className="msg-text" rows={12} value={text} onChange={(e) => setEdited(e.target.value)} />
            </label>
            <div className="two">
              <button type="button" className="btn primary" onClick={() => void share()}>
                <Icon icon={Share2} />
                {t('msg.share')}
              </button>
              <button type="button" className="btn" onClick={() => void copy()}>
                <Icon icon={ClipboardCopy} />
                {t('msg.copy')}
              </button>
            </div>
          </>
        )}
        <div className="row wrap">
          {handedOver && (
            <button type="button" className="btn primary" onClick={() => void mark('verstuurd')}>
              <Icon icon={Check} />
              {t('msg.sent')}
            </button>
          )}
          <button type="button" className="btn quiet" onClick={() => void mark('niet-nodig')}>
            <Icon icon={X} />
            {t('msg.notNeeded')}
          </button>
        </div>
      </div>
      {filling && <FieldSheet store={store} notify={notify} trip={trip} field={filling} onClose={() => setFilling(null)} />}
    </Sheet>
  )
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Het blok Berichten op de trip: per soort een knop, met een vinkje als het verstuurd of niet nodig is. */
export function TripMessages({ store, notify, trip, heading: Heading }: { store: Store; notify: Notify; trip: Trip; heading: 'h2' | 'h3' }) {
  const templates = effectiveTemplates(useCollection(store, 'templates.json.enc'))
  const [open, setOpen] = useState<MessageKindInfo | null>(null)
  const uiLang = getLang()
  const kinds = messageKinds(templates)
  return (
    <div className="section stack-sm trip-messages">
      <Heading>{t('msg.section')}</Heading>
      <ul className="plain-list stack-sm">
        {kinds.map((kind) => {
          const mark = trip.messages?.[kind.kind]
          return (
            <li key={kind.kind} className="row msg-row">
              <span className="grow">
                {kindLabel(kind, uiLang)}
                {mark && (
                  <span className="muted small">
                    {' · '}
                    <Icon icon={Check} />
                    {mark.status === 'verstuurd' ? t('msg.sentOn', { date: formatDate(mark.date) }) : t('msg.notNeededOn', { date: formatDate(mark.date) })}
                  </span>
                )}
              </span>
              <button type="button" className={`btn small${mark ? '' : ' primary'}`} onClick={() => setOpen(kind)}>
                <Icon icon={Send} />
                {t('msg.make', { kind: kindLabel(kind, uiLang) })}
              </button>
            </li>
          )
        })}
      </ul>
      {open && <MessageSheet store={store} notify={notify} trip={trip} kind={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Meer → Berichten: per soort de sjablonen, toevoegen, en een eigen soort toevoegen. */
export function MessageTemplatesView({ store, notify }: { store: Store; notify: Notify }) {
  const templates = effectiveTemplates(useCollection(store, 'templates.json.enc'))
  const [editing, setEditing] = useState<{ template: MessageTemplate | null; kind: MessageKindInfo } | null>(null)
  const [newKind, setNewKind] = useState(false)
  const uiLang = getLang()
  return (
    <div className="stack-lg message-templates">
      {messageKinds(templates).map((kind) => {
        const own = templates.filter((x) => x.kind === kind.kind)
        return (
          <div key={kind.kind} className="section stack-sm">
            <h2>{kindLabel(kind, uiLang)}</h2>
            {own.length === 0 && <p className="muted small">{t('msg.none')}</p>}
            <ul className="rows">
              {own.map((x) => (
                <li key={x.id}>
                  <button type="button" className="row-item row-button" onClick={() => setEditing({ template: x, kind })}>
                    <span className="row-main">
                      <span>{templateLine(x)}</span>
                      <span className="muted small msg-snippet">{textForDisplay(x.text, uiLang).split('\n').find((l) => l.trim()) ?? ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn" onClick={() => setEditing({ template: null, kind })}>
              <Icon icon={Plus} />
              {t('msg.addTemplate')}
            </button>
          </div>
        )
      })}
      <button type="button" className="btn" onClick={() => setNewKind(true)}>
        <Icon icon={Plus} />
        {t('msg.addKind')}
      </button>
      {newKind && (
        <TemplateSheet
          store={store}
          notify={notify}
          template={null}
          kind={{ kind: `eigen:${crypto.randomUUID()}`, name: '' }}
          onClose={() => setNewKind(false)}
        />
      )}
      {editing && <TemplateSheet store={store} notify={notify} template={editing.template} kind={editing.kind} onClose={() => setEditing(null)} />}
    </div>
  )
}
