import { getModelForClass, prop } from '@typegoose/typegoose'

/** `utm_campaign` values that count (the web drops anything else) */
export const CAMPAIGN = /^[A-Za-z0-9_-]{1,64}$/

export const campaignOf = (value: unknown) =>
  typeof value === 'string' && CAMPAIGN.test(value) ? value : undefined

/**
 * New accounts per UTC day and campaign: promo links land on todorant.com with `utm_campaign`, and
 * stats.borodutch.com reads these counts. Only the aggregate, never a user id or anything per person
 */
export class CampaignSignup {
  /** UTC day, YYYY-MM-DD */
  @prop({ required: true })
  day: string
  @prop({ required: true })
  campaign: string
  @prop({ required: true })
  count: number
}

export const CampaignSignupModel = getModelForClass(CampaignSignup, {
  schemaOptions: { collection: 'campaignsignups', versionKey: false },
})

/** Counts one new account for its campaign, if it came with a valid one. Never fails the sign-up */
export async function countSignup(campaign: unknown, at = new Date()) {
  const valid = campaignOf(campaign)
  if (!valid) return
  const filter = { day: at.toISOString().slice(0, 10), campaign: valid }
  const increment = () =>
    CampaignSignupModel.updateOne(
      filter,
      { $inc: { count: 1 } },
      { upsert: true }
    )
  try {
    // Two first sign-ups of a day racing to insert the row: the loser's retry finds it
    await increment().catch((error) =>
      error?.code === 11000 ? increment() : Promise.reject(error)
    )
  } catch (error) {
    console.error(
      'Could not count a campaign sign-up:',
      (error as Error)?.message
    )
  }
}
