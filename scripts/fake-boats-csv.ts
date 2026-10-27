// Gegenereerde mijlenregistratie als CSV-export (komma's, datums als d/m/jj, "12 nm") met dezelfde soorten waarden in
// de kolom Schip als het origineel: "Naam (Model)", alleen een model, alleen een naam, en een lengte in het model.
// Alle bootnamen, modellen, plaatsen en getallen zijn verzonnen.

const SHIPS = [
  'Nepzwaan (Nepteau SO 519)',
  'Sportnep 680',
  'Nepkoala X',
  'Nepaak 38ft',
  'Neptrude (nepship 26ft)',
  'Nepvlinder (Nepgoon 42)',
  'Nepbries (Nepali 4.2)',
  'Nepvaart (Nepteau O 48 ft)',
]

const HEADER =
  'Datum,Van (plaats),Van (land),Naar (plaats),Naar (land),Rol,Schip,Schipper/trainer,Co-schipper (flot.leider),Wind (bft),Binnenwater,Zee,Zee (getijnavigatie),Totaal,Nacht-uren,Bijzonderheden'

export function buildFakeBoatsCsv(): string {
  const lines = [
    ',,,,,,,,,Schipper,10 nm,100 nm,40 nm,150 nm,3,',
    ',,,,,,,,,Co-schipper,0 nm,20 nm,0 nm,20 nm,0,',
    ',,,,,,,,,bem./trainee:,0 nm,10 nm,0 nm,10 nm,0,',
    ',,,,,,,,,totaal:,10 nm,130 nm,40 nm,180 nm,3,',
    ',,,,,,,,,,,,,,,',
    HEADER,
    ',,,,,,,,,,,,,,,',
  ]
  SHIPS.forEach((ship, i) => {
    const month = i + 1
    for (let day = 1; day <= 2; day++) {
      const date = day === 1 ? `${day + 2}/${month}/25` : ''
      const name = day === 1 ? `Neptocht ${i + 1}` : ''
      lines.push(`${date},Nephaven ${i},Nepland,Nepbaai ${i},Nepland,Schipper,${ship},,,2 bft,,${10 + day} nm,,${10 + day} nm,,${name}`)
    }
    lines.push(',,,,,,,,,,,,,,,')
  })
  return lines.join('\r\n') + '\r\n'
}
