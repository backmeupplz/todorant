import { HeroModel } from '@/models/hero'
import { TagModel } from '@/models/tag'
import { TodoModel } from '@/models/todo'
import { UserModel } from '@/models/user'

/**
 * Compound indexes for every v2 (and the hot v1) query. Built in the background on startup;
 * createIndex is a no-op when an index already exists.
 */
export function ensureIndexes() {
  const background = { background: true }
  return Promise.all([
    // Delta pulls for both sides of delegation
    TodoModel.collection.createIndex({ user: 1, updatedAt: 1 }, background),
    TodoModel.collection.createIndex({ delegator: 1, updatedAt: 1 }, { ...background, partialFilterExpression: { delegator: { $exists: true } } }),
    // Day lists, current todo, planning/completed pages, v1's per-user scans
    TodoModel.collection.createIndex({ user: 1, completed: 1, monthAndYear: 1, date: 1, frog: -1, order: 1 }, background),
    // v1 WatermelonDB pushes match by client id
    TodoModel.collection.createIndex({ user: 1, clientId: 1 }, { ...background, partialFilterExpression: { clientId: { $exists: true } } }),
    TagModel.collection.createIndex({ user: 1, updatedAt: 1 }, background),
    TagModel.collection.createIndex({ user: 1, deleted: 1, tag: 1 }, background),
    HeroModel.collection.createIndex({ user: 1 }, background),
    UserModel.collection.createIndex({ delegates: 1 }, background),
  ])
}
