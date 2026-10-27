// Een lokaal gemaakt bestand delen (deelmenu van de telefoon) of, zonder deelfunctie, downloaden. Het bestand verlaat
// het apparaat alleen als Olivier zelf een app kiest; de app stuurt niets naar buiten (beveiligingsregel 2).

export async function shareOrDownload(file: File, title: string): Promise<void> {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return
    }
  } catch (e) {
    // Afgebroken door Olivier: niets doen.
    if (e instanceof Error && e.name === 'AbortError') return
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
