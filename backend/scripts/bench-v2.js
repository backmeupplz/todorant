// v1 vs v2 benchmark against a running local backend (node 18+, mongo on localhost:27017):
//   node scripts/bench-v2.js

const M = '../node_modules/'
const { MongoClient, ObjectId } = require(M + 'mongodb')
const WebSocket = require(M + 'ws')
const io = require(M + 'socket.io-client')
const zlib = require('zlib')
const B = 'http://localhost:1337'
const post = (p, body, token) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)]
const stats = (a) => `p50 ${pct(a, 0.5).toFixed(1)} ms, p95 ${pct(a, 0.95).toFixed(1)} ms`
const kb = (n) => (n / 1024).toFixed(1) + ' KB'

async function seed() {
  const user = await (await post('/login/anonymous', {})).json()
  const db = (await MongoClient.connect('mongodb://localhost:27017', { useUnifiedTopology: true })).db('todorant')
  const uid = new ObjectId(user._id)
  const todos = []
  const start = new Date('2024-10-01')
  for (let i = 0; i < 5000; i++) {
    const d = new Date(start.getTime() + (i % 760) * 864e5)
    const completed = d < new Date('2026-10-13') ? Math.random() < 0.97 : false
    const created = new Date(Math.min(d.getTime() - 864e5, Date.now() - 864e5))
    todos.push({ user: uid, text: `Task ${i} lorem ipsum dolor sit amet #tag${i % 60}`, completed, frog: i % 17 === 0, frogFails: 0, skipped: false,
      order: i % 9, deleted: i % 50 === 0, encrypted: false, repetitive: false,
      monthAndYear: d.toISOString().slice(0, 7), date: d.toISOString().slice(8, 10), createdAt: created, updatedAt: created, __v: 0 })
  }
  await db.collection('todos').insertMany(todos)
  await db.collection('tags').insertMany(Array.from({ length: 60 }, (_, i) => ({ user: uid, tag: `tag${i}`, deleted: false, epic: false, numberOfUses: 80, createdAt: start, updatedAt: start })))
  return { user, db }
}

async function http(path, token, headers, n = 200) {
  const times = []
  let bytes = 0
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint()
    const r = await fetch(B + path, { headers: { ...headers, 'accept-encoding': 'identity' } })
    const body = await r.arrayBuffer()
    times.push(ms(t))
    bytes = body.byteLength
  }
  return { times, bytes }
}

function v1Socket(token) {
  return new Promise((res) => {
    const s = io('http://localhost:3000', { transports: ['websocket'] })
    s.on('connect', () => s.emit('authorize', token, '2'))
    s.on('authorized', () => res(s))
  })
}
const v1Pull = (s, last) => new Promise((res) => {
  const t = process.hrtime.bigint()
  s.once('return_wmdb', (changes, ts) => res({ time: ms(t), bytes: Buffer.byteLength(JSON.stringify(changes)), ts, changes }))
  s.emit('get_wmdb', last)
})

function v2Socket(token) {
  return new Promise((res) => {
    const ws = new WebSocket('ws://localhost:1337/v2/ws?token=' + token, { perMessageDeflate: true })
    let raw = 0
    ws._socket // eslint
    ws.on('upgrade', (r) => r.socket.on('data', (d) => (ws.raw = (ws.raw || 0) + d.length)))
    let rid = 0
    const waiters = {}
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'hello') res(api); if (m.rid && waiters[m.rid]) waiters[m.rid](m, d.length); else if (ws.onChange) ws.onChange(m) })
    const api = { ws, sync: (msg) => new Promise((r) => { const id = ++rid; const t = process.hrtime.bigint(); waiters[id] = (m, len) => r({ m, time: ms(t), bytes: len }); ws.send(JSON.stringify({ t: 'sync', rid: id, ...msg })) }) }
  })
}

;(async () => {
  const { user, db } = await seed()
  const token = user.token
  console.log(`Seeded 5000 todos (${await db.collection('todos').countDocuments({ user: new ObjectId(user._id) })}), 60 tags\n`)

  console.log('Current todo (widget / web "current")')
  const v1c = await http('/todo/current?date=2026-10-13', token, { token })
  const v2c = await http('/v2/todos/current?date=2026-10-13', token, { authorization: 'Bearer ' + token })
  console.log(`  v1 GET /todo/current          ${stats(v1c.times)}, ${kb(v1c.bytes)}`)
  console.log(`  v2 GET /v2/todos/current      ${stats(v2c.times)}, ${kb(v2c.bytes)}\n`)

  console.log('Planning page (first 30)')
  const v2l = await http('/v2/todos?limit=30', token, { authorization: 'Bearer ' + token })
  const v1l = await http('/todo?completed=false&hash=&skip=0&limit=30&today=2026-10-13&calendarView=false&date=2026-10-13&time=12:00', token, { token }, 50)
  console.log(`  v1 GET /todo (planning)        ${stats(v1l.times)}, ${kb(v1l.bytes)}`)
  console.log(`  v2 GET /v2/todos               ${stats(v2l.times)}, ${kb(v2l.bytes)}\n`)

  // Sync: full pull
  const s1 = await v1Socket(token)
  const full1 = []
  let v1Full
  for (let i = 0; i < 10; i++) { v1Full = await v1Pull(s1, null); full1.push(v1Full.time) }
  const a = await v2Socket(token)
  const full2 = []
  let v2Full
  for (let i = 0; i < 10; i++) { v2Full = await a.sync({ since: 0 }); full2.push(v2Full.time) }
  const json2 = Buffer.byteLength(JSON.stringify(v2Full.m))
  console.log('Full sync (fresh device)')
  console.log(`  v1 socket.io get_wmdb   ${stats(full1)}, ${kb(v1Full.bytes)} JSON (no compression)`)
  console.log(`  v2 ws sync              ${stats(full2)}, ${kb(json2)} JSON, ${kb(zlib.deflateRawSync(JSON.stringify(v2Full.m)).length)} on the wire (permessage-deflate)\n`)

  // Delta pull with nothing changed
  const d1 = [], d2 = []
  let dv1, dv2
  for (let i = 0; i < 50; i++) { dv1 = await v1Pull(s1, v1Full.ts); d1.push(dv1.time) }
  for (let i = 0; i < 50; i++) { dv2 = await a.sync({ since: v2Full.m.cursor }); d2.push(dv2.time) }
  console.log('Delta sync, nothing changed (reconnect)')
  console.log(`  v1 get_wmdb             ${stats(d1)}, ${dv1.bytes} B`)
  console.log(`  v2 sync since cursor    ${stats(d2)}, ${Buffer.byteLength(JSON.stringify(dv2.m))} B\n`)

  // Edit one todo on device A, time until device B has it
  const someTodo = v2Full.m.todos[0]
  const b = await v2Socket(token)
  const prop = []
  let changeBytes = 0
  for (let i = 0; i < 30; i++) {
    const got = new Promise((r) => (b.ws.onChange = (m) => { if (m.t === 'changes') { changeBytes = Buffer.byteLength(JSON.stringify(m)); r() } }))
    const t = process.hrtime.bigint()
    a.sync({ ops: [{ c: 'todo', id: someTodo.id, at: Date.now(), set: { completed: i % 2 === 0 } }] })
    await got
  }
  b.ws.onChange = undefined
  // v1: push via push_wmdb, other device gets "wmdb" ping then pulls
  const s2 = await v1Socket(token)
  const v1prop = []
  let last2 = (await v1Pull(s2, null)).ts
  let v1Bytes = 0
  const raw = (await v1Pull(s1, null)).changes.todos.updated[0]
  for (let i = 0; i < 30; i++) {
    const t = process.hrtime.bigint()
    const done = new Promise((r) => s2.once('wmdb', async () => { const p = await v1Pull(s2, last2); last2 = p.ts; v1Bytes = p.bytes; r() }))
    const changes = { todos: { created: [], updated: [{ ...raw, id: undefined, is_completed: i % 2 === 0, updated_at: Date.now() }], deleted: [] }, tags: { created: [], updated: [], deleted: [] } }
    await done
    v1prop.push(ms(t))
  }
  console.log('Edit on one device → visible on another')
  console.log(`  v1 push_wmdb → "wmdb" ping → get_wmdb   ${stats(v1prop)}, ${kb(v1Bytes)} pulled per change`)
  console.log(`  v2 sync op → live "changes"             ${stats(prop)}, ${changeBytes} B per change`)
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
