// Used instead of mongodb-memory-server when TEST_MONGO is set (see jest.config.js):
// every test file gets its own database on the given server.
let counter = 0
class MongoMemoryServer {
  constructor() {
    this.uri = `${process.env.TEST_MONGO.replace(/\/$/, '')}/todorant_test_${process.pid}_${counter++}`
  }
  async getUri() {
    return this.uri
  }
  async stop() {}
}
module.exports = { MongoMemoryServer }
