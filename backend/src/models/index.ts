import * as mongoose from 'mongoose'

// Keep Mongoose 5's behaviour: Mongoose 6 strips filter fields missing from the schema and throws on
// populating them (sockets populate `delegator` on tags too)
mongoose.set('strictQuery', false)
mongoose.set('strictPopulate', false)

export function runMongo(mongoUrl = process.env.MONGO) {
  return mongoose.connect(mongoUrl)
}
export function stopMongo() {
  return mongoose.disconnect()
}
