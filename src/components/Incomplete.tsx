import { t } from '../i18n'

// "Onvolledig": niets is verplicht, ontbrekende gegevens krijgen een badge in plaats van een blokkade.

export function IncompleteBadge() {
  return <span className="badge-incomplete">{t('gaps.badge')}</span>
}

/** "Onvolledig: model, lengte" in een formulier. */
export function IncompleteLine({ missing }: { missing: readonly string[] }) {
  return (
    <p className="muted small incomplete-line">
      <IncompleteBadge /> {missing.map((m) => m.toLowerCase()).join(', ')}
    </p>
  )
}
