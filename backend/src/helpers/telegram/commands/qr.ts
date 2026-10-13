import { Context } from 'telegraf'
import { report } from '@/helpers/report'
import { toBuffer } from 'qrcode'

/** Sends the login token as a QR code; the message deletes itself after 5 minutes */
export async function sendQR(ctx: Context) {
  try {
    const png = await toBuffer(ctx.dbuser.token, { width: 300, margin: 2 })
    const msg = await ctx.replyWithPhoto({ source: png })
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id)
      } catch (err) {
        report(err)
      }
    }, 5 * 60 * 1000)
  } catch (err) {
    report(err)
  }
}
