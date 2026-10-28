import * as mongoose from 'mongoose'
import {
  ARRIVAL,
  mongoStore,
  promos,
  startPayload,
} from '@/helpers/telegram/promo'
import { Context } from 'telegraf'
import { UserModel } from '@/models/user'

// Prime Radiant's reply promos (promo.ts): a line or button under /start and
// /help in private chats, and reports for people other bots' campaigns bring
// here. Off until PROMO_TOKEN is set.
export const promo = promos(
  'todorant',
  mongoStore(
    mongoose.connection.collection('promos') as unknown as Parameters<
      typeof mongoStore
    >[0]
  )
)

// Before every other middleware: a private chat blocking the bot (blocked),
// and /start <campaign>-<variant>-<bot> from another bot's campaign, before
// the login wall so people without an account count too (new = no account)
export async function promoUpdates(ctx: Context, next: () => Promise<unknown>) {
  const member = (
    ctx.update as {
      my_chat_member?: {
        chat: { type: string }
        from?: { id: number }
        new_chat_member?: { status: string }
      }
    }
  ).my_chat_member
  if (member) {
    // nothing else here handles these (ctx.chat is undefined for them)
    if (
      member.chat.type === 'private' &&
      member.new_chat_member?.status === 'kicked'
    )
      promo.blocked(member.from?.id)
    return
  }
  const payload = startPayload(ctx.message?.text)
  if (ctx.chat?.type === 'private' && ctx.from && ARRIVAL.test(payload || ''))
    await promo.arrived(
      ctx.from.id,
      payload,
      !(await UserModel.exists({ telegramId: `${ctx.from.id}` }))
    )
  return next()
}

// After the login wall: someone a campaign brought here has an account and
// uses the bot (use, once a day, for 7 days)
export function promoUse(ctx: Context, next: () => Promise<unknown>) {
  void promo.used(ctx.from?.id)
  return next()
}
