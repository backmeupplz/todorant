import { resolve } from 'path'

// The Sign in with Apple key that /login/apple signs its client secret with.
// Defaults to Todorant's own key file; a replacement key is set through the env
// without a code change, either as the key itself or as a path to the .p8 file
export function appleAuthKey(env: NodeJS.ProcessEnv = process.env) {
  const keyId = env.APPLE_KEY_ID || 'M3N8Y594JS'
  const teamId = env.APPLE_TEAM_ID || 'ACWP4F58HZ'
  if (env.APPLE_PRIVATE_KEY) {
    return {
      keyId,
      teamId,
      // Env editors often keep a pasted key on one line with literal \n
      privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      method: 'text' as const,
    }
  }
  return {
    keyId,
    teamId,
    privateKey:
      env.APPLE_KEY_PATH || resolve(__dirname, '../../assets/AppleAuth.p8'),
    method: 'file' as const,
  }
}
