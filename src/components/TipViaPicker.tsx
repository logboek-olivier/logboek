import { t } from '../i18n'
import type { TipVia } from '../model/types'

// Fooi contant of op de bank. Contant staat in Geld → Contant tot hij gestort is, zodat niets dubbel telt.

export function TipViaPicker({ value, onChange, allowUnknown = false }: { value: TipVia | null; onChange: (via: TipVia | null) => void; allowUnknown?: boolean }) {
  const options: (TipVia | null)[] = allowUnknown ? ['contant', 'bank', null] : ['contant', 'bank']
  return (
    <div className="segments small" role="radiogroup" aria-label={t('tipVia.label')}>
      {options.map((via) => (
        <button key={via ?? 'onbekend'} type="button" role="radio" aria-checked={value === via} className={`segment${value === via ? ' active' : ''}`} onClick={() => onChange(via)}>
          {t(`tipVia.${via ?? 'onbekend'}`)}
        </button>
      ))}
    </div>
  )
}
