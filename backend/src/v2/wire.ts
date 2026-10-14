import { Collection, fields } from '@/v2/schema'

const ms = (date: unknown) =>
  date instanceof Date
    ? date.getTime()
    : typeof date === 'number'
    ? date
    : undefined

/** Mongo document → compact wire object: id, synced fields, owner ids, ms timestamps; nulls dropped */
export function wire(
  collection: Collection,
  doc: Record<string, any>,
  only?: string[]
) {
  const out: Record<string, unknown> = { id: String(doc._id) }
  for (const field of only || Object.keys(fields[collection])) {
    if (doc[field] !== undefined && doc[field] !== null) out[field] = doc[field]
  }
  if (!only) {
    if (doc.user) out.user = String(doc.user)
    if (doc.delegator) out.delegator = String(doc.delegator)
    // Cleared on purpose (the delegator deleted their account): devices merge fields, so say so
    else if (doc.delegator === null) out.delegator = null
    if (doc.createdAt) out.createdAt = ms(doc.createdAt)
  }
  if (doc.updatedAt) out.updatedAt = ms(doc.updatedAt)
  return out
}
