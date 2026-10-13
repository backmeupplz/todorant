import { Context } from 'koa'
import { Controller, Ctx, Flow, Get, Post } from 'koa-ts-controllers'
import { authenticate } from '@/middlewares/authenticate'
import {
  getGoogleCalendarOAuthURL,
  getGoogleCalendarToken,
} from '@/helpers/googleCalendar'
import { sign, verify } from '@/helpers/jwt'
import { startWatch } from '@/helpers/googleCalendarChannel'

@Controller('/google')
export default class GoogleController {
  @Get('/calendarAuthenticationURL')
  @Flow(authenticate)
  async calendarAuthenticationURL(@Ctx() ctx: Context) {
    // Google hands it back with the code: proof that this account opened the consent screen
    const state = await sign({
      calendar: String(ctx.state.user._id),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    return getGoogleCalendarOAuthURL(!!ctx.query.web, state)
  }

  @Post('/calendarAuthorize')
  @Flow(authenticate)
  async calendarAuthorize(@Ctx() ctx: Context) {
    const { code, state } = ctx.request.body
    if (!code) {
      return ctx.throw(403)
    }
    // A link with someone else's code would connect their calendar to this account and stream our
    // todos into it; clients that pass the state back are safe from that (old ones don't send it)
    if (
      state !== undefined &&
      !(await verify(String(state)).then(
        (payload: any) => payload.calendar === String(ctx.state.user._id),
        () => false
      ))
    ) {
      return ctx.throw(403, 'Invalid state')
    }
    const credentials = await getGoogleCalendarToken(
      code,
      !!ctx.request.body.web
    )
    const userId = ctx.state.user._id
    startWatch(credentials, userId)
    return credentials
  }

  @Post('/notifications')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async post(@Ctx() ctx: Context) {
    //   try {
    //     const id = ctx.request.header['x-goog-channel-id']
    //     const user = await UserModel.findOne({
    //       _id: id,
    //     })
    //     const credentials = user.settings.googleCalendarCredentials
    //     const api = getGoogleCalendarApi(credentials)
    //     const todorantCalendar = await getTodorantCalendar(api)
    //     const events = await getGoogleEvents(api, todorantCalendar)
    //     const deletedEvents = events.filter((event) => {
    //       return event.status === 'cancelled'
    //     })
    //     const timedEvents = events.filter((event) => {
    //       if (!event.start) {
    //         return false
    //       }
    //       return event.start.dateTime
    //     })
    //     deletedEvents.forEach(async (event) => {
    //       await TodoModel.findOneAndUpdate(
    //         {
    //           _id: event.id,
    //           time: { $ne: null },
    //         },
    //         { completed: true }
    //       )
    //     })
    //     const changedTodos = [] as Todo[]
    //     timedEvents.forEach(async (event) => {
    //       const eventDate = event.start.dateTime
    //       const todo = await TodoModel.findOne({
    //         _id: event.id,
    //       })
    //       if (!todo) {
    //         return
    //       }
    //       const monthAndYearInEvent = eventDate.substr(0, 7)
    //       const timeInEvent = eventDate.substr(11, 5)
    //       const dateInEvent = eventDate.substr(8, 2)
    //       let needsSaving = false
    //       if (timeInEvent !== todo.time) {
    //         todo.time = timeInEvent
    //         needsSaving = true
    //       }
    //       if (dateInEvent !== todo.date) {
    //         todo.date = dateInEvent
    //         needsSaving = true
    //       }
    //       if (monthAndYearInEvent !== todo.monthAndYear) {
    //         todo.monthAndYear = monthAndYearInEvent
    //         needsSaving = true
    //       }
    //       if (needsSaving) {
    //         todo.save()
    //         changedTodos.push(todo)
    //       }
    //     })
    //     // Fix order
    //     await fixOrder(
    //       user,
    //       changedTodos.map((t) => getTitle(t))
    //     )
    //     // Trigger sync
    //     requestSync(user._id)
    //     ctx.status = 200
    //   } catch (err) {
    //     ctx.status = 500
    //   }
  }
}
