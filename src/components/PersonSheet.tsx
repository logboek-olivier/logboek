import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { MAX_COUNTRY, MAX_TAG } from '../model/guests'
import { PERSON_ROLES, type Participant, type PersonRole, type Trip } from '../model/types'
import { Sheet } from './Sheet'

// Meer → Personen: een persoon toevoegen aan een trip, of de rol, voornaam, land of kenmerk wijzigen. Alleen voornaam,
// land en een kort kenmerk (regel 14); de rol zegt wat iemand op die trip was: student, gast, crew, medezeiler,
// schipper of overig. Een student krijgt zijn checklist en notities (in Personen een tik op de student).

export interface PersonForm {
  firstName: string
  role: PersonRole
  country: string
  tag: string
  /** Bij toevoegen: de trip (een student mag zonder trip). */
  tripId: string
}

export function PersonSheet({
  person,
  trips,
  tripLabel,
  defaultTripId,
  defaultRole,
  onSave,
  onClose,
}: {
  /** null = toevoegen. */
  person: { participant: Participant; role: PersonRole; trip: Trip } | null
  trips: readonly Trip[]
  tripLabel: (trip: Trip) => string
  defaultTripId: string | null
  defaultRole: PersonRole
  onSave: (form: PersonForm) => void
  onClose: () => void
}) {
  const [firstName, setFirstName] = useState(person?.participant.firstName ?? '')
  const [role, setRole] = useState<PersonRole>(person?.role ?? defaultRole)
  const [country, setCountry] = useState(person?.participant.country ?? '')
  const [tag, setTag] = useState(person?.participant.tag ?? '')
  const [tripId, setTripId] = useState(person?.trip.id ?? defaultTripId ?? '')
  // Iedereen behalve een student hoort bij een trip (een student mag ook zonder trip, zoals in het archief).
  const ok = firstName.trim() !== '' && (person !== null || tripId !== '' || role === 'student')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (ok) onSave({ firstName, role, country, tag, tripId })
  }
  return (
    <Sheet title={person ? t('people.edit') : t('people.add')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          {t('students.firstName')}
          <input type="text" autoComplete="off" autoCapitalize="words" maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus={!person} />
        </label>
        <div className="type-buttons" role="radiogroup" aria-label={t('people.role')}>
          {PERSON_ROLES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} className={`chip${role === r ? ' active' : ''}`} onClick={() => setRole(r)}>
              {t(`personRole.${r}`)}
            </button>
          ))}
        </div>
        {!person && (
          <label>
            {t('people.trip')}
            <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
              <option value="">{role === 'student' ? t('students.noTrip') : t('people.chooseTrip')}</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {tripLabel(trip)}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
