/** crypto-js compatible AES ("Salted__" + EVP_BytesToKey with MD5), the format all Todorant clients share */

function md5(data: Uint8Array): Uint8Array {
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)
  const len = ((data.length + 8) >>> 6) * 64 + 64
  const buf = new Uint8Array(len)
  buf.set(data)
  buf[data.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(len - 8, data.length * 8, true)
  view.setUint32(len - 4, Math.floor(data.length / 2 ** 29), true)
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  for (let off = 0; off < len; off += 64) {
    let [a, b, c, d] = [a0, b0, c0, d0]
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) (f = (b & c) | (~b & d)), (g = i)
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16)
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16)
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16)
      const r = s[(i >> 4) * 4 + (i % 4)]
      const x = (a + f + K[i] + view.getUint32(off + g * 4, true)) | 0
      ;[a, d, c] = [d, c, b]
      b = (b + ((x << r) | (x >>> (32 - r)))) | 0
    }
    ;[a0, b0, c0, d0] = [(a0 + a) | 0, (b0 + b) | 0, (c0 + c) | 0, (d0 + d) | 0]
  }
  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true))
  return new Uint8Array(out.buffer)
}

async function keyAndIv(password: string, salt: Uint8Array, usage: KeyUsage) {
  const pass = new TextEncoder().encode(password)
  let derived: Uint8Array = new Uint8Array(0)
  let block: Uint8Array = new Uint8Array(0)
  while (derived.length < 48) {
    block = md5(new Uint8Array([...block, ...pass, ...salt]))
    derived = new Uint8Array([...derived, ...block])
  }
  const key = await crypto.subtle.importKey('raw', new Uint8Array(derived.slice(0, 32)), 'AES-CBC', false, [usage])
  return { key, iv: new Uint8Array(derived.slice(32, 48)) }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0))

export async function encrypt(plain: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(8))
  const { key, iv } = await keyAndIv(password, salt, 'encrypt')
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(plain)))
  return b64(new Uint8Array([...new TextEncoder().encode('Salted__'), ...salt, ...body]))
}

/** null when the password is wrong or the text isn't encrypted */
export async function decrypt(encrypted: string, password: string) {
  try {
    const bytes = unb64(encrypted)
    if (bytes.length < 16 || new TextDecoder().decode(bytes.slice(0, 8)) !== 'Salted__') return null
    const { key, iv } = await keyAndIv(password, bytes.slice(8, 16), 'decrypt')
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, bytes.slice(16))
    return new TextDecoder('utf-8', { fatal: true }).decode(plain) || null
  } catch {
    return null
  }
}

export { md5 }
