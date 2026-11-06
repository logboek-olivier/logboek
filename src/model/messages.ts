import type { Tx } from '../domain/tx'
import { addDays } from '../basis/datum'
import { organisationOfTrip } from '../basis/organisatie'
import { translate, type Lang, type MessageKey } from '../i18n'
import { organisationLabel } from '../i18n/labels'
import { placeKey } from './places'
import { currentSettings, saveSettings } from './settings'
import { tripKind } from './trip-kind'
import {
  keepUnknownFields,
  MESSAGE_FIELDS,
  newId,
  type Leg,
  type MessageDefaults,
  type MessageField,
  type MessageTemplate,
  type Participant,
  type Place,
  type Settings,
  type Trip,
  type WeekType,
} from './types'

// Berichtengenerator (Meer → Berichten, het blok Berichten op de trip, de herinnering op Vandaag). Een sjabloon is
// gewone tekst met invulvelden; de app vult ze in uit de trip, de boot, de plaatsen en de standaard van de organisatie.
// Wat ontbreekt, staat gemarkeerd en houdt delen tegen: nooit een {veld} letterlijk in een bericht. De app verstuurt
// zelf niets (delen of kopiëren) en bewaart de tekst van een bericht nooit; alleen "verstuurd" of "niet nodig" met de
// datum, op de trip (regel 14: voornamen alleen in de trip).

export const STANDARD_KINDS = ['introductie', 'afsluiting'] as const
export type StandardKind = (typeof STANDARD_KINDS)[number]

/** Een invulveld. In de opgeslagen tekst staat `{sleutel}`; in beeld `{naam in de taal van de app}`. */
export const TOKENS = [
  'guests',
  'boat',
  'boatType',
  'boatModel',
  'meetingPlace',
  'meetingTime',
  'startDate',
  'endDate',
  'checkIn',
  'checkOut',
  'endPlace',
  'skipper',
  'organisation',
  'nights',
] as const
export type Token = (typeof TOKENS)[number]

/** Velden die de app zelf niet weet en die per trip (en als standaard per organisatie) in te vullen zijn. */
export const FIELD_TOKENS: readonly MessageField[] = MESSAGE_FIELDS

export const DEFAULT_INTRO_DAYS = 3
export const MAX_TEMPLATE_LENGTH = 4000
const MAX_FIELD_LENGTH = 120

const tokenLabel = (token: Token, lang: Lang) => translate(lang, `msgToken.${token}` as MessageKey)

/** De naam van een invulveld in een taal (voor de chips en de tekst in beeld). */
export function tokenName(token: Token, lang: Lang): string {
  return tokenLabel(token, lang)
}

const tokenPattern = /\{([^{}\n]{1,40})\}/g

/** Herkent een invulveld aan zijn sleutel of aan zijn naam in een van beide talen (zonder hoofdletters). */
function tokenOf(name: string): Token | null {
  const key = name.trim().toLowerCase()
  for (const token of TOKENS) {
    if (token.toLowerCase() === key) return token
    if (tokenLabel(token, 'nl').toLowerCase() === key || tokenLabel(token, 'en').toLowerCase() === key) return token
  }
  return null
}

/** Tekst zoals Olivier hem ziet en typt → opgeslagen tekst (`{guests}` …). Onbekende accolades blijven gewone tekst. */
export function textForStorage(text: string): string {
  return text.replace(tokenPattern, (whole, name: string) => {
    const token = tokenOf(name)
    return token ? `{${token}}` : whole
  })
}

/** Opgeslagen tekst → tekst in beeld, met de namen van de invulvelden in de taal van de app. */
export function textForDisplay(text: string, lang: Lang): string {
  return text.replace(tokenPattern, (whole, name: string) => {
    const token = (TOKENS as readonly string[]).includes(name) ? (name as Token) : null
    return token ? `{${tokenLabel(token, lang)}}` : whole
  })
}

/** Meegeleverde voorbeelden (Engels). Pas opgeslagen als Olivier ze bewerkt (zelfde id); een tombstone verbergt ze. */
export const SEED_TEMPLATES: readonly MessageTemplate[] = [
  {
    id: 'seed-introductie-en',
    kind: 'introductie',
    lang: 'en',
    text: [
      'Hi {guests},',
      '',
      "Welcome aboard. I'm {skipper}, your skipper for the week with {organisation}, and I'm looking forward to sailing with you.",
      '',
      'Our boat is {boat}, a {boatModel} ({boatType}). We meet at {meetingPlace} on {startDate} at {meetingTime}. Check-in on board is at {checkIn}.',
      '',
      'What to bring:',
      '- soft luggage, no hard suitcases',
      '- shoes with light soles for on deck, sunscreen, a hat and sunglasses',
      '- a light waterproof jacket',
      '- your passport or ID',
      '',
      'We spend {nights} nights on board and finish at {endPlace} on {endDate}, with check-out at {checkOut}.',
      '',
      'If you have any questions before the trip, just reply to this message.',
      '',
      'See you soon,',
      '{skipper}',
    ].join('\n'),
    updatedAt: '2026-11-06T00:00:00.000Z',
    deletedAt: null,
  },
  {
    id: 'seed-afsluiting-en',
    kind: 'afsluiting',
    lang: 'en',
    text: [
      'Hi {guests},',
      '',
      'Thank you for a great week on {boat}. It was a pleasure sailing with you, and I hope you enjoyed it as much as I did.',
      '',
      'I hope to see you again on the water some time.',
      '',
      'Fair winds,',
      '{skipper}',
    ].join('\n'),
    updatedAt: '2026-11-06T00:00:00.000Z',
    deletedAt: null,
  },
]
const SEED_IDS = new Set(SEED_TEMPLATES.map((t) => t.id))

/** Zichtbare sjablonen: opgeslagen (niet verwijderd) plus meegeleverde die niet opgeslagen of verwijderd zijn. */
export function effectiveTemplates(stored: readonly MessageTemplate[]): MessageTemplate[] {
  const byId = new Map(stored.map((t) => [t.id, t]))
  const result: MessageTemplate[] = []
  for (const seed of SEED_TEMPLATES) {
    const own = byId.get(seed.id)
    if (!own) result.push(seed)
    else if (own.deletedAt === null) result.push(own)
  }
  for (const t of stored) if (!SEED_IDS.has(t.id) && t.deletedAt === null) result.push(t)
  return result
}

export interface MessageKindInfo {
  kind: string
  /** De naam van een eigen soort; bij introductie en afsluiting leeg (die komen uit de vertaling). */
  name?: string
}

/** Introductie en afsluiting, plus de eigen soorten uit de sjablonen. */
export function messageKinds(templates: readonly MessageTemplate[]): MessageKindInfo[] {
  const kinds: MessageKindInfo[] = STANDARD_KINDS.map((kind) => ({ kind }))
  for (const t of templates) {
    if ((STANDARD_KINDS as readonly string[]).includes(t.kind) || kinds.some((k) => k.kind === t.kind)) continue
    kinds.push({ kind: t.kind, name: t.kindName?.trim() || t.kind })
  }
  return kinds
}

export function kindLabel(info: MessageKindInfo, lang?: Lang): string {
  if ((STANDARD_KINDS as readonly string[]).includes(info.kind)) return lang ? translate(lang, `msgKind.${info.kind as StandardKind}`) : translate('nl', `msgKind.${info.kind as StandardKind}`)
  return info.name ?? info.kind
}

/**
 * De sjablonen voor een soort bericht bij een trip, beste eerst: organisatie én soort trip, dan alleen organisatie, dan
 * alleen soort trip, dan de algemene terugval (zonder beide). Een sjabloon voor een andere organisatie of soort trip valt
 * af. Bij gelijke stand (bijvoorbeeld een Engels en een Nederlands sjabloon) kiest Olivier zelf; de app kiest nooit een
 * taal.
 */
export function templatesFor(templates: readonly MessageTemplate[], kind: string, organisation: string, tripType: WeekType | undefined): MessageTemplate[] {
  const scored: Array<{ t: MessageTemplate; score: number }> = []
  for (const t of templates) {
    if (t.kind !== kind) continue
    if (t.organisation && t.organisation !== organisation) continue
    if (t.tripType && t.tripType !== tripType) continue
    scored.push({ t, score: (t.organisation ? 2 : 0) + (t.tripType ? 1 : 0) })
  }
  const best = Math.max(-1, ...scored.map((s) => s.score))
  return scored
    .filter((s) => s.score === best)
    .map((s) => s.t)
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.id.localeCompare(b.id))
}

/** De standaard van een organisatie voor de berichtvelden en de dagen vooraf. */
export function messageDefaultsOf(settings: Pick<Settings, 'messageDefaults'>, organisation: string): MessageDefaults {
  return settings.messageDefaults?.[organisation] ?? {}
}

export function introDaysBefore(settings: Pick<Settings, 'messageDefaults'>, organisation: string): number {
  const n = messageDefaultsOf(settings, organisation).introDaysBefore
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 60 ? n : DEFAULT_INTRO_DAYS
}

export interface MessageContext {
  legs: readonly Leg[]
  places: readonly Place[]
  settings: Pick<Settings, 'messageDefaults'>
}

/** Waar een veld vandaan komt: van deze trip, de standaard van de organisatie, of uit de trip afgeleid. */
export type FieldSource = 'trip' | 'organisatie' | 'afgeleid'

/** De waarde van een berichtveld voor een trip: van de trip, anders de standaard van de organisatie, anders afgeleid. */
export function fieldValue(trip: Trip, field: MessageField, ctx: MessageContext): { value: string; source: FieldSource } | null {
  const own = trip.messageFields?.[field]?.trim()
  if (own) return { value: own, source: 'trip' }
  const standard = messageDefaultsOf(ctx.settings, organisationOfTrip(trip))[field]?.trim()
  if (standard) return { value: standard, source: 'organisatie' }
  if (field === 'endPlace' && trip.base?.trim()) return { value: trip.base.trim(), source: 'afgeleid' }
  if (field === 'skipper') {
    const skipper = (trip.participants ?? []).find((p) => p.role === 'schipper')
    if (skipper) return { value: skipper.firstName, source: 'afgeleid' }
    const fromLegs = ctx.legs
      .filter((l) => l.deletedAt === null && l.tripId === trip.id && l.skipperName?.trim())
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (fromLegs) return { value: fromLegs.skipperName!.trim(), source: 'afgeleid' }
  }
  return null
}

/** De gasten van een trip voor een bericht: iedereen behalve de schipper, alleen de voornaam (regel 14). */
export function messageGuests(trip: Trip): Participant[] {
  return (trip.participants ?? []).filter((p) => p.role !== 'schipper' && p.firstName.trim() !== '')
}

const LOCALE: Record<Lang, string> = { nl: 'nl-NL', en: 'en-GB' }

function longDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
}

function nightsBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000)
}

/** Een link naar de kaart bij een plaats met een pin (de app opent hem niet; hij staat alleen in de tekst). */
export function mapLink(place: Pick<Place, 'lat' | 'lon'>): string {
  return `https://maps.google.com/?q=${place.lat.toFixed(5)},${place.lon.toFixed(5)}`
}

/** Elk invulveld met zijn waarde voor deze trip, in de taal van het sjabloon; null = ontbreekt. */
export function messageValues(trip: Trip, ctx: MessageContext, lang: Lang): Record<Token, string | null> {
  const field = (f: MessageField) => fieldValue(trip, f, ctx)?.value ?? null
  const guests = messageGuests(trip).map((p) => p.firstName.trim().split(/\s+/)[0]!)
  const boat = trip.boat?.trim() || ctx.legs.filter((l) => l.deletedAt === null && l.tripId === trip.id && l.boat?.trim()).sort((a, b) => a.date.localeCompare(b.date))[0]?.boat.trim() || null
  const org = organisationOfTrip(trip)
  const meeting = field('meetingPlace')
  const pin = meeting ? ctx.places.find((p) => p.deletedAt === null && placeKey(p.name) === placeKey(meeting) && Number.isFinite(p.lat) && Number.isFinite(p.lon)) : undefined
  const boatType =
    trip.boatKind === 'catamaran' ? translate(lang, 'msgBoat.catamaran') : trip.boatKind === 'eenromp' ? translate(lang, 'msgBoat.monohull') : trip.boatKind === 'motor' ? translate(lang, 'msgBoat.motor') : null
  return {
    guests: guests.length > 0 ? new Intl.ListFormat(LOCALE[lang], { type: 'conjunction' }).format(guests) : null,
    boat,
    boatType,
    boatModel: trip.boatModel?.trim() || null,
    meetingPlace: meeting ? (pin ? `${meeting} (${mapLink(pin)})` : meeting) : null,
    meetingTime: field('meetingTime'),
    startDate: trip.startDate ? longDate(trip.startDate, lang) : null,
    endDate: trip.endDate ? longDate(trip.endDate, lang) : null,
    checkIn: field('checkIn'),
    checkOut: field('checkOut'),
    endPlace: field('endPlace'),
    skipper: field('skipper'),
    organisation: org === 'overig' || org === 'eigen' || org === 'delivery' ? null : organisationLabel(org, lang),
    nights: trip.startDate && trip.endDate && trip.endDate >= trip.startDate ? String(nightsBetween(trip.startDate, trip.endDate)) : null,
  }
}

export type MessagePart = { text: string } | { missing: Token }

export interface FilledMessage {
  parts: MessagePart[]
  /** De ontbrekende invulvelden, elk één keer, in volgorde van de tekst. */
  missing: Token[]
  /** De tekst als alles is ingevuld; null zolang er iets ontbreekt (dan kan er niets gedeeld worden). */
  text: string | null
}

/** Vult een sjabloon in. Een ontbrekend veld wordt een gemarkeerd deel; de tekst bestaat pas als niets ontbreekt. */
export function fillTemplate(template: Pick<MessageTemplate, 'text'>, values: Record<Token, string | null>): FilledMessage {
  const parts: MessagePart[] = []
  const missing: Token[] = []
  let last = 0
  const source = textForStorage(template.text)
  for (const match of source.matchAll(tokenPattern)) {
    const token = (TOKENS as readonly string[]).includes(match[1]!) ? (match[1] as Token) : null
    if (!token) continue
    if (match.index! > last) parts.push({ text: source.slice(last, match.index) })
    const value = values[token]
    if (value === null || value.trim() === '') {
      parts.push({ missing: token })
      if (!missing.includes(token)) missing.push(token)
    } else parts.push({ text: value })
    last = match.index! + match[0].length
  }
  if (last < source.length) parts.push({ text: source.slice(last) })
  // Aaneengesloten tekst samenvoegen (makkelijker te tonen en te testen).
  const merged: MessagePart[] = []
  for (const part of parts) {
    const prev = merged.at(-1)
    if ('text' in part && prev && 'text' in prev) merged[merged.length - 1] = { text: prev.text + part.text }
    else merged.push(part)
  }
  return { parts: merged, missing, text: missing.length === 0 ? merged.map((p) => ('text' in p ? p.text : '')).join('') : null }
}

/** Een veld dat Olivier kan invullen als het ontbreekt (de andere komen uit de trip zelf: Trip bewerken). */
export function isFieldToken(token: Token): token is MessageField {
  return (FIELD_TOKENS as readonly string[]).includes(token)
}

export interface MessageReminder {
  trip: Trip
  kind: StandardKind
}

/**
 * Herinneringen op Vandaag: "Introductie sturen voor <trip>" vanaf X dagen vóór de start (X per organisatie, standaard
 * 3) tot en met de startdag, en "Afsluiting sturen" vanaf de laatste dag van de trip, drie dagen lang. Alleen bij werk
 * met datums; weg na "Verstuurd" of "Niet nodig".
 */
export function messageReminders(trips: readonly Trip[], legs: readonly Leg[], settings: Pick<Settings, 'messageDefaults'>, today: string): MessageReminder[] {
  const out: MessageReminder[] = []
  for (const trip of trips) {
    if (trip.deletedAt !== null || !trip.startDate || !trip.endDate) continue
    if (tripKind(trip, legs).kind !== 'werk') continue
    const marks = trip.messages ?? {}
    const days = introDaysBefore(settings, organisationOfTrip(trip))
    if (!marks.introductie && today >= addDays(trip.startDate, -days) && today <= trip.startDate) out.push({ trip, kind: 'introductie' })
    if (!marks.afsluiting && today >= trip.endDate && today <= addDays(trip.endDate, 2)) out.push({ trip, kind: 'afsluiting' })
  }
  return out.sort((a, b) => (a.kind === 'afsluiting' ? a.trip.endDate! : a.trip.startDate!).localeCompare(b.kind === 'afsluiting' ? b.trip.endDate! : b.trip.startDate!))
}

// ── Schrijven (alleen via opdrachten in src/domain/berichten.ts) ──────────────────────────────────────────────────

export interface TemplateInput {
  kind: string
  kindName?: string
  lang: Lang
  organisation?: string
  tripType?: WeekType
  /** Tekst zoals in beeld (namen van invulvelden) of opgeslagen (sleutels): beide worden sleutels. */
  text: string
}

/** Sjabloon opslaan (nieuw of bewerkt; een meegeleverd sjabloon houdt zijn id). Geeft het id terug. */
export async function saveTemplate(tx: Tx, id: string | null, input: TemplateInput): Promise<string> {
  const previous = id ? (tx.get('templates.json.enc').find((t) => t.id === id) ?? SEED_TEMPLATES.find((t) => t.id === id)) : undefined
  const kind = input.kind.trim() || 'introductie'
  const kindName = (STANDARD_KINDS as readonly string[]).includes(kind) ? undefined : input.kindName?.trim().slice(0, 60) || undefined
  const next: MessageTemplate = {
    id: id ?? newId(),
    kind,
    ...(kindName ? { kindName } : {}),
    lang: input.lang === 'nl' ? 'nl' : 'en',
    ...(input.organisation ? { organisation: input.organisation } : {}),
    ...(input.tripType ? { tripType: input.tripType } : {}),
    text: textForStorage(input.text).slice(0, MAX_TEMPLATE_LENGTH),
    updatedAt: tx.now,
    deletedAt: null,
  }
  await tx.put('templates.json.enc', keepUnknownFields(previous, next, ['id', 'kind', 'kindName', 'lang', 'organisation', 'tripType', 'text', 'updatedAt', 'deletedAt']))
  return next.id
}

/** Een nieuwe eigen soort bericht: een eerste sjabloon met die naam. */
export function newKindId(): string {
  return `eigen:${newId()}`
}

/** Sjabloon verwijderen: een tombstone zonder tekst (een meegeleverd sjabloon blijft zo verborgen). */
export async function deleteTemplate(tx: Tx, id: string): Promise<void> {
  const previous = tx.get('templates.json.enc').find((t) => t.id === id) ?? SEED_TEMPLATES.find((t) => t.id === id)
  if (!previous) return
  await tx.put('templates.json.enc', { id, kind: previous.kind, lang: previous.lang, text: '', updatedAt: tx.now, deletedAt: tx.now })
}

function liveTrip(tx: Tx, tripId: string): Trip {
  const trip = tx.get('trips.json.enc').find((t) => t.id === tripId && t.deletedAt === null)
  if (!trip) throw new Error('Trip bestaat niet')
  return trip
}

/**
 * Een berichtveld voor deze trip invullen (leeg = weer de standaard). De ingevulde waarde wordt ook de standaard van de
 * organisatie: de laatst gebruikte waarde is de standaard voor de volgende trip.
 */
export async function setMessageField(tx: Tx, tripId: string, field: MessageField, value: string): Promise<void> {
  const trip = liveTrip(tx, tripId)
  const clean = value.trim().slice(0, MAX_FIELD_LENGTH)
  const fields = { ...(trip.messageFields ?? {}) }
  if (clean) fields[field] = clean
  else delete fields[field]
  await tx.put('trips.json.enc', { ...trip, messageFields: fields, updatedAt: tx.now })
  if (!clean) return
  const org = organisationOfTrip(trip)
  const settings = currentSettings(tx.get('settings.json.enc'))
  if (settings.messageDefaults?.[org]?.[field] === clean) return
  await saveSettings(tx, { messageDefaults: { ...(settings.messageDefaults ?? {}), [org]: { ...(settings.messageDefaults?.[org] ?? {}), [field]: clean } } })
}

/** Verstuurd of niet nodig voor een soort bericht bij een trip (null = weer open). */
export async function markMessage(tx: Tx, tripId: string, kind: string, status: 'verstuurd' | 'niet-nodig' | null, date: string): Promise<void> {
  const trip = liveTrip(tx, tripId)
  const marks = { ...(trip.messages ?? {}) }
  if (status) marks[kind] = { status, date }
  else delete marks[kind]
  await tx.put('trips.json.enc', { ...trip, messages: marks, updatedAt: tx.now })
}

/** Een standaard voor berichten zonder lege velden en met geldige dagen vooraf (0–60); null als er niets overblijft. */
export function cleanMessageDefaults(defaults: MessageDefaults): MessageDefaults | null {
  const clean: MessageDefaults = {}
  for (const f of MESSAGE_FIELDS) {
    const v = defaults[f]?.trim().slice(0, MAX_FIELD_LENGTH)
    if (v) clean[f] = v
  }
  const days = defaults.introDaysBefore
  if (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 60) clean.introDaysBefore = days
  return Object.keys(clean).length > 0 ? clean : null
}

/** De standaard van een organisatie voor berichten. Lege velden vallen weg. */
export async function setMessageDefaults(tx: Tx, organisation: string, defaults: MessageDefaults): Promise<void> {
  const settings = currentSettings(tx.get('settings.json.enc'))
  const clean = cleanMessageDefaults(defaults)
  const all = { ...(settings.messageDefaults ?? {}) }
  if (clean) all[organisation] = clean
  else delete all[organisation]
  await saveSettings(tx, { messageDefaults: all })
}
