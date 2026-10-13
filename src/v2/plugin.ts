import * as mongoose from 'mongoose'
import { fields } from '@/v2/schema'
import { hint, publish } from '@/v2/hub'
import { wire } from '@/v2/wire'

/**
 * Typegoose `@plugin(v2Sync, { collection })` on Todo and Tag: every v1 write gets per-field
 * write timestamps (`_fts`) too, so v2's field-level last-writer-wins also respects edits made
 * by old clients, and v2 devices get v1 changes in real time.
 */
export function v2Sync(schema: mongoose.Schema, { collection }: { collection: 'todo' | 'tag' }) {
  const synced = Object.keys(fields[collection])
  schema.add({ _fts: mongoose.Schema.Types.Mixed })

  schema.pre('save', function (this: mongoose.Document & { _fts?: Record<string, number> }) {
    const now = Date.now()
    const fts = { ...(this._fts || {}) }
    for (const field of synced) if (this.isNew || this.isModified(field)) fts[field] = now
    this.set('_fts', fts)
  })
  schema.post('save', function (doc: mongoose.Document & Record<string, any>) {
    const message = { t: 'changes', [collection + 's']: [wire(collection, doc.toObject())] }
    publish(doc.user, message)
    if (collection === 'todo' && doc.delegator) publish(doc.delegator, message)
  })

  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'update']) {
    schema.pre(op, function (this: mongoose.Query<unknown>) {
      const update = this.getUpdate() as Record<string, any>
      if (!update) return
      const changed = synced.filter((f) => f in update || f in (update.$set || {}) || f in (update.$inc || {}))
      if (!changed.length) return
      const now = Date.now()
      update.$set = { ...(update.$set || {}), ...Object.fromEntries(changed.map((f) => [`_fts.${f}`, now])) }
    })
    schema.post(op, function (this: mongoose.Query<unknown>) {
      const user = (this.getFilter() as Record<string, any>).user
      if (user && typeof user !== 'object') hint(user)
    })
  }
}
