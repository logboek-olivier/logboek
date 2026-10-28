import { formatMoney } from '../format'
import { t } from '../i18n'
import { participantName } from '../model/guests'
import { draftTotal, EMPTY_TIP, type TipDraft } from '../model/tip-draft'
import type { Currency, Participant } from '../model/types'

// "Van wie" bij een fooi: één of meer deelnemers als knoppen, "Hele groep" of "Onbekend" (standaard). Bij meerdere
// personen "Samen gegeven" (één bedrag) of "Per persoon" (een bedrag per persoon; het totaal is de som).

export function TipFromPicker({ participants, value, onChange, currency }: { participants: readonly Participant[]; value: TipDraft; onChange: (draft: TipDraft) => void; currency: Currency }) {
  const total = draftTotal(value)

  function togglePerson(id: string) {
    if (value.kind !== 'personen') return onChange({ ...EMPTY_TIP, kind: 'personen', ids: [id] })
    const ids = value.ids.includes(id) ? value.ids.filter((x) => x !== id) : [...value.ids, id]
    onChange(ids.length === 0 ? EMPTY_TIP : { ...value, ids })
  }

  return (
    <fieldset className="tip-from">
      <legend>{t('tip.from')}</legend>
      <div className="type-buttons">
        {participants.map((p) => {
          const on = value.kind === 'personen' && value.ids.includes(p.id)
          return (
            <button key={p.id} type="button" aria-pressed={on} className={`chip${on ? ' active' : ''}`} onClick={() => togglePerson(p.id)}>
              {participantName(p, participants)}
            </button>
          )
        })}
        <button type="button" aria-pressed={value.kind === 'groep'} className={`chip${value.kind === 'groep' ? ' active' : ''}`} onClick={() => onChange({ ...EMPTY_TIP, kind: 'groep' })}>
          {t('tip.group')}
        </button>
        <button type="button" aria-pressed={value.kind === 'onbekend'} className={`chip${value.kind === 'onbekend' ? ' active' : ''}`} onClick={() => onChange(EMPTY_TIP)}>
          {t('tip.unknown')}
        </button>
      </div>
      {value.kind === 'personen' && value.ids.length > 1 && (
        <>
          <div className="segments small" role="radiogroup" aria-label={t('tip.from')}>
            {[false, true].map((split) => (
              <button key={String(split)} type="button" role="radio" aria-checked={value.split === split} className={`segment${value.split === split ? ' active' : ''}`} onClick={() => onChange({ ...value, split })}>
                {t(split ? 'tip.perPerson' : 'tip.together')}
              </button>
            ))}
          </div>
          {value.split && (
            <div className="tip-split">
              {value.ids.map((id) => {
                const p = participants.find((x) => x.id === id)
                if (!p) return null
                const name = participantName(p, participants)
                return (
                  <label key={id}>
                    {name}
                    <input inputMode="decimal" autoComplete="off" aria-label={t('tip.amountFor', { name })} value={value.amounts[id] ?? ''} onChange={(e) => onChange({ ...value, amounts: { ...value.amounts, [id]: e.target.value } })} />
                  </label>
                )
              })}
            </div>
          )}
          {value.split && total !== undefined && total !== null && <p className="muted small">{t('tip.total', { amount: formatMoney(total, currency) })}</p>}
        </>
      )}
    </fieldset>
  )
}
