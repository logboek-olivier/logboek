import { Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t, useLang } from '../i18n'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { MAX_COUNTRY, MAX_TAG, participantName } from '../model/guests'
import { STUDENT_LEVELS, type Participant, type StudentLevel, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { deelnemerVerwijderen, deelnemerWijzigen } from '../domain/trips'

// Eén deelnemer bewerken of verwijderen. Een periode verwijderen staat onder "⋯" op de periodepagina
// (src/components/PeriodMenu.tsx). Trips mogen overlappen: daar is geen melding of keuze meer voor.

/** Eén deelnemer: alle velden, en onderaan verwijderen (met ongedaan maken). Alleen voornaam, land en kort kenmerk (regel 14). */
export function ParticipantSheet({ store, trip, participant, notify, onClose }: { store: Store; trip: Trip; participant: Participant; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const curricula = effectiveCurricula(store.get('curricula.json.enc'))
  const [firstName, setFirstName] = useState(participant.firstName)
  const [country, setCountry] = useState(participant.country ?? '')
  const [tag, setTag] = useState(participant.tag ?? '')
  const [level, setLevel] = useState<StudentLevel | ''>(participant.level ?? '')
  const [course, setCourse] = useState(participant.curriculumId ?? '')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || !firstName.trim()) return
    setBusy(true)
    try {
      const { country: _c, tag: _t, level: _l, curriculumId: _k, guestId, ...rest } = participant
      void [_c, _t, _l, _k]
      const sameGuest = firstName.trim().toLowerCase() === participant.firstName.toLowerCase() && country.trim().toLowerCase() === (participant.country ?? '').toLowerCase()
      const next: Participant = {
        ...rest,
        firstName: firstName.trim().slice(0, 40),
        ...(country.trim() ? { country: country.trim().slice(0, MAX_COUNTRY) } : {}),
        ...(tag.trim() ? { tag: tag.trim().slice(0, MAX_TAG) } : {}),
        ...(level ? { level } : {}),
        ...(course ? { curriculumId: course } : {}),
        // Andere naam of ander land: niet meer dezelfde gast (de vraag over een terugkerende gast komt dan opnieuw).
        ...(guestId && sameGuest ? { guestId } : {}),
      }
      await deelnemerWijzigen(store, trip, participant.id, next)
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deelnemerVerwijderen(store, trip, participant.id)
    onClose()
    notify(t('participant.removed', { name: participantName(participant, trip.participants ?? []) }), undo)
  }

  return (
    <Sheet title={t('participant.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <label>
          {t('students.firstName')}
          <input type="text" autoComplete="off" autoCapitalize="words" maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <div className="two">
          <label>
            {t('guest.country')}
            <input type="text" autoComplete="off" autoCapitalize="words" maxLength={MAX_COUNTRY} value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label>
            {t('guest.tag')}
            <input type="text" autoComplete="off" maxLength={MAX_TAG} value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('students.level')}
            <select value={level} onChange={(e) => setLevel(e.target.value as StudentLevel | '')}>
              <option value="">–</option>
              {STUDENT_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`level.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('students.course')}
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">–</option>
              {curricula.map((c) => (
                <option key={c.id} value={c.id}>
                  {courseLabel(c, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy || !firstName.trim()}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Users} />
            {t('participant.remove')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
