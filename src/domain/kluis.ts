// Opdrachten voor de kluis. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { addDocument, updateDocument } from '../model/documents'
import { deleteDocument } from '../model/edit'
import { opdracht, opdrachtMet } from './opdracht'

export const documentBewerken = opdrachtMet('documentBewerken', updateDocument)
export const documentToevoegen = opdrachtMet('documentToevoegen', addDocument)
export const documentVerwijderen = opdracht('documentVerwijderen', deleteDocument)
