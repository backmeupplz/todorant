import { Context } from 'koa'
import { Controller, Ctx, Flow, Post, Put } from 'koa-ts-controllers'
import { authenticate } from '@/middlewares/authenticate'
import { requestSync } from '@/sockets/index'

@Controller('/settings')
export default class SettingsController {
  @Post('/')
  @Flow(authenticate)
  async post(@Ctx() ctx: Context) {
    // Set settings
    ctx.state.user.settings = {
      ...(ctx.state.user.settings || {}),
      ...(ctx.request.body || {}),
      ...{ updatedAt: new Date() },
    }
    if (!ctx.request.body.startTimeOfDay) {
      ctx.state.user.settings.startTimeOfDay =
        ctx.state.user.settings.startTimeOfDay || undefined
    }
    await ctx.state.user.save()
    // Respond
    ctx.status = 200
    // Trigger sync
    requestSync(ctx.state.user._id)
  }

  @Put('/')
  @Flow(authenticate)
  async put(@Ctx() ctx: Context) {
    // Set settings
    if (
      typeof ctx.request.body.showTodayOnAddTodo === 'string' ||
      ctx.request.body.showTodayOnAddTodo instanceof String
    ) {
      ctx.request.body.showTodayOnAddTodo =
        ctx.request.body.showTodayOnAddTodo === '1'
    }
    if (
      typeof ctx.request.body.newTodosGoFirst === 'string' ||
      ctx.request.body.newTodosGoFirst instanceof String
    ) {
      ctx.request.body.newTodosGoFirst =
        ctx.request.body.newTodosGoFirst === '1'
    }
    ctx.state.user.settings = {
      ...(ctx.state.user.settings || {}),
      ...(ctx.request.body || {}),
      ...{ updatedAt: new Date() },
    }
    if (!ctx.request.body.startTimeOfDay) {
      ctx.state.user.settings.startTimeOfDay =
        ctx.state.user.settings.startTimeOfDay || undefined
    }
    await ctx.state.user.save()
    // Respond
    ctx.status = 200
    // Trigger sync
    requestSync(ctx.state.user._id)
  }

  @Post('/username')
  @Flow(authenticate)
  async setUserName(@Ctx() ctx: Context) {
    ctx.state.user.name = ctx.request.body.name || ctx.state.user.name
    await ctx.state.user.save()
    // Respond
    ctx.status = 200
    // Trigger sync
    requestSync(ctx.state.user._id)
  }
}
