/** Compact QR encoder: byte mode, error correction level M, versions 1–20 (Nayuki's algorithm, condensed) */

// Per version, level M: ECC codewords per block and number of blocks
const EC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]
const MAX = EC.length

/** Modules left for data + ECC after the function patterns */
function rawModules(v: number) {
  let r = (16 * v + 128) * v + 64
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (v >= 7) r -= 36
  }
  return r
}
const dataCodewords = (v: number) => (rawModules(v) >> 3) - EC[v - 1] * BLOCKS[v - 1]

// region Reed–Solomon over GF(256), polynomial 0x11D

function mul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function divisor(degree: number) {
  const r = new Array<number>(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) r[j] = mul(r[j], root) ^ (j + 1 < degree ? r[j + 1] : 0)
    root = mul(root, 2)
  }
  return r
}

function remainder(data: number[], div: number[]) {
  const r = div.map(() => 0)
  for (const b of data) {
    const factor = b ^ r.shift()!
    r.push(0)
    div.forEach((c, i) => (r[i] ^= mul(c, factor)))
  }
  return r
}

// endregion

/** BCH-coded 15 format bits for level M (bits 00) and a mask */
function formatBits(mask: number) {
  let rem = mask
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((mask << 10) | rem) ^ 0x5412
}
function versionBits(v: number) {
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (v << 12) | rem
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

/** Codewords: header, data, padding, then ECC per block, interleaved */
function codewords(bytes: Uint8Array) {
  let v = 1
  while (v <= MAX && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++
  if (v > MAX) throw new Error('Too long for a QR code')
  const capacity = dataCodewords(v) * 8
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(4, 4)
  put(bytes.length, v < 10 ? 8 : 16)
  bytes.forEach((b) => put(b, 8))
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  const blocks = BLOCKS[v - 1]
  const ec = EC[v - 1]
  const raw = rawModules(v) >> 3
  const shortLen = Math.floor(raw / blocks) - ec
  const shortCount = blocks - (raw % blocks)
  const div = divisor(ec)
  const split: [number[], number[]][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const d = data.slice(k, (k += shortLen + (i < shortCount ? 0 : 1)))
    split.push([d, remainder(d, div)])
  }
  const out: number[] = []
  for (let i = 0; i <= shortLen; i++) for (const [d] of split) if (i < d.length) out.push(d[i])
  for (let i = 0; i < ec; i++) for (const [, e] of split) out.push(e[i])
  return { v, out }
}

/** Penalty score of a masked matrix (ISO 18004 rules N1–N4) */
function penalty(m: number[][]) {
  const size = m.length
  const lines = [...m.map((r) => r.join('')), ...m.map((_, x) => m.map((r) => r[x]).join(''))]
  let score = 0
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) ?? []) score += run.length - 2
    score += (('0000' + line + '0000').match(/(?=10111010000|00001011101)/g)?.length ?? 0) * 40
  }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  const dark = m.flat().filter(Boolean).length
  const total = size * size
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
}

/** QR matrix for a text (rows of 1 = dark); `forceMask` is for tests */
export function qr(text: string, forceMask?: number): number[][] {
  const { v, out } = codewords(new TextEncoder().encode(text))
  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean | number) => ((m[y][x] = dark ? 1 : 0), (fn[y][x] = true))

  for (let i = 0; i < size; i++) set(6, i, i % 2 === 0), set(i, 6, i % 2 === 0)
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  if (v > 1) {
    const n = Math.floor(v / 7) + 2
    const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
    const pos = [6]
    for (let i = 0, p = size - 7; i < n - 1; i++, p -= step) pos.splice(1, 0, p)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
  }
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask)
    const bit = (i: number) => (bits >>> i) & 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, 1)
  }
  drawFormat(0)
  if (v >= 7) {
    const bits = versionBits(v)
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  // Zigzag data placement, two columns at a time from the bottom right
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!fn[y][x] && i < out.length * 8) m[y][x] = (out[i >>> 3] >>> (7 - (i & 7))) & 1, i++
      }
  }

  const applyMask = (k: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] ^= 1
  }
  let best = forceMask ?? 0
  if (forceMask === undefined) {
    let min = Infinity
    for (let k = 0; k < 8; k++) {
      applyMask(k)
      drawFormat(k)
      const p = penalty(m)
      if (p < min) (min = p), (best = k)
      applyMask(k)
    }
  }
  applyMask(best)
  drawFormat(best)
  return m
}

/** Assert-based self-check against published test vectors */
export function qrSelfTest() {
  const assert = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`qr self-test failed: ${what}`)
  }
  // "HELLO WORLD" 1-M data codewords → ECC (thonky.com tutorial)
  const ecc = remainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], divisor(10))
  assert(ecc.join() === '196,35,39,119,235,215,231,226,93,23', 'reed-solomon')
  assert(formatBits(0).toString(2) === '101010000010010', 'format M/0')
  assert(formatBits(5).toString(2) === '100000011001110', 'format M/5')
  assert(versionBits(7).toString(2).padStart(18, '0') === '000111110010010100', 'version 7')
  assert([1, 10, 20].map(dataCodewords).join() === '16,216,669', 'capacity')
  assert(qr('x'.repeat(250)).length === 61, 'version 11 for 250 bytes')
  const m = qr('https://todorant.com')
  assert(m.length === 25, 'version 2 for 20 bytes')
  // Finder corners dark, separator light, dark module set
  assert(m[0][0] === 1 && m[0][24] === 1 && m[24][0] === 1 && m[7][7] === 0 && m[17][8] === 1, 'function patterns')
  return true
}
