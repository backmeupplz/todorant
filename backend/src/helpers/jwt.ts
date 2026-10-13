import * as jwksClient from 'jwks-rsa'
import * as jwt from 'jsonwebtoken'

export function sign<T extends Record<string, unknown>>(
  payload: T
): Promise<string> {
  return new Promise((res, rej) => {
    jwt.sign(payload, process.env.JWT, undefined, (err, token) => {
      return err ? rej(err) : res(token)
    })
  })
}

export function verify(token: string) {
  return new Promise((res, rej) => {
    // What sign() makes; never 'none' (jsonwebtoken 8 allows it when the secret is missing)
    jwt.verify(
      token,
      process.env.JWT,
      { algorithms: ['HS256'] },
      (err, payload) => {
        return err ? rej(err) : res(payload)
      }
    )
  })
}

const APPLE_BASE_URL = 'https://appleid.apple.com'

export const getApplePublicKey = async (kid) => {
  const client = jwksClient({
    cache: true,
    jwksUri: `${APPLE_BASE_URL}/auth/keys`,
  })
  const key: any = await new Promise((resolve, reject) => {
    client.getSigningKey(kid, (error, result) => {
      if (error) {
        return reject(error)
      }
      return resolve(result)
    })
  })
  return (
    (key.publicKey as jwksClient.CertSigningKey) ||
    (key.rsaPublicKey as jwksClient.RsaSigningKey)
  )
}

export async function verifyAppleToken(idToken: string, clientId?: string) {
  const decoded = jwt.decode(idToken, { complete: true })
  const { kid } = (decoded as any).header
  const applePublicKey = await getApplePublicKey(kid)
  // Apple signs with RS256; trusting the token's own `alg` allows HS256 signed with the public key
  const jwtClaims = jwt.verify(idToken, applePublicKey as any, {
    algorithms: ['RS256'],
  }) as any
  if (clientId && jwtClaims.aud !== clientId) {
    throw new Error(
      `The aud parameter does not include this client - is: ${jwtClaims.aud} | expected: ${clientId}`
    )
  }
  return jwtClaims
}
