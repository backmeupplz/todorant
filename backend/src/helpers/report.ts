import Telegraf from 'telegraf'

export const bot = new Telegraf(process.env.TELEGRAM_LOGIN_TOKEN)

export const errorSenderBot = new Telegraf(
  process.env.TELEGRAM_ERROR_SENDER_TOKEN
)
;(() => {
  if (process.env.NODE_ENV === 'test') return
  if (process.env.TELEGRAM_ERROR_SENDER_TOKEN) {
    errorSenderBot.launch().then(() => {
      console.log('error sender bot launched')
    })
  } else {
    console.log(
      'Telegram error reports disabled (errors go to the log): set TELEGRAM_ERROR_SENDER_TOKEN and CHAT_ID'
    )
  }
})()

export async function tryReport<T>(fun: (() => T) | Promise<T>) {
  try {
    const result = await (fun instanceof Function ? fun() : fun)
    return result
  } catch (err) {
    await report(err)
    return undefined
  }
}

export async function report(err: Error, extra?: string) {
  const dismissableErrors = [
    'No authentication token provided',
    'invalid_grant',
    'Resource has been deleted',
    'not found for project',
    'Old API version',
  ]
  try {
    const text = `Todorant Error:\n${err.message || JSON.stringify(err)}${
      err.stack ? `\n\n${err.stack}` : ''
    }${extra ? `\n\n${extra}` : ''}`
    for (const errorText of dismissableErrors) {
      if (text.indexOf(errorText) > -1) {
        return
      }
    }
    if (process.env.CHAT_ID && process.env.TELEGRAM_ERROR_SENDER_TOKEN) {
      await errorSenderBot.telegram.sendMessage(process.env.CHAT_ID, text)
    } else {
      console.error(text)
    }
  } catch (error) {
    console.error(err)
    console.error(error)
  }
}
