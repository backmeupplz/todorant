import { Context, Extra } from 'telegraf'
import { ExtraReplyMessage } from 'telegraf/typings/telegram-types'
import { html, keyboard } from '@/helpers/telegram/promo'
import { promo } from '@/helpers/telegram/helpers/promo'

export async function sendHelp(ctx: Context) {
  // checkIfPrivate lets only private chats through; the promo checks it again.
  // Todorant calls Ukrainian "ua"; campaigns use the standard "uk"
  const language = ctx.dbuser?.telegramLanguage || ctx.from?.language_code
  const d = await promo.decide(
    ctx.from?.id,
    ctx.chat?.type,
    language === 'ua' ? 'uk' : language
  )
  const extra = Extra.HTML(true) as ExtraReplyMessage
  const markup = keyboard(d?.promo, undefined)
  const sent = await ctx.reply(ctx.i18n.t('help') + html(d?.promo), {
    ...extra,
    ...(d?.promo ? { disable_web_page_preview: true } : {}),
    ...(markup ? { reply_markup: markup } : {}),
  } as ExtraReplyMessage)
  await promo.record(d)
  return sent
}
