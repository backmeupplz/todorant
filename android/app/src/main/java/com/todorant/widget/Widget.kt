package com.todorant.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.style.URLSpan
import android.view.View
import android.widget.RemoteViews
import com.todorant.App
import com.todorant.MainActivity
import com.todorant.R
import com.todorant.data.Db
import com.todorant.data.Session
import com.todorant.data.Todo
import com.todorant.logic.Todos
import com.todorant.logic.isolateHashtags
import com.todorant.logic.todayTitle
import com.todorant.sync.Sync
import com.todorant.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch

private const val ACTION_DONE = "com.todorant.widget.DONE"
private const val ACTION_DELETE = "com.todorant.widget.DELETE"
private const val ACTION_SKIP = "com.todorant.widget.SKIP"
private const val ACTION_REFRESH = "com.todorant.widget.REFRESH"

/**
 * Home screen widget showing the current todo. Unlike the RN widget, which called the REST API
 * behind the app's back, it reads and changes the local database and lets sync push the changes.
 */
object Widget {
    /** Keeps widgets in step with every database change */
    @OptIn(FlowPreview::class)
    fun init() {
        App.scope.launch { Db.changes.debounce(500).collect { refresh() } }
    }

    /** Redraws every widget from the database */
    fun refresh() {
        val context = App.context
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, WidgetProvider::class.java))
        // refreshWidgetAndBadgeAndWatch in the RN app
        App.scope.launch(Dispatchers.IO) {
            com.todorant.Reminders.updateBadge()
            if (ids.isNotEmpty()) update(context, manager, ids)
        }
    }

    internal fun update(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val loggedIn = Session.user != null
        val uncompleted = if (loggedIn) Todos.forDay(todayTitle(), false) else emptyList()
        val total = if (loggedIn) uncompleted.size + Todos.forDay(todayTitle(), true).size else 0
        for (id in ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id), loggedIn, uncompleted.firstOrNull(), total, total - uncompleted.size))
    }

    private fun views(context: Context, options: Bundle, loggedIn: Boolean, todo: Todo?, total: Int, done: Int): RemoteViews {
        if (!loggedIn) return RemoteViews(context.packageName, R.layout.widget_error).apply {
            setTextViewText(R.id.tv_message, t("pleaseLogin"))
            setOnClickPendingIntent(R.id.tv_message, openApp(context, addTodo = false))
        }
        return RemoteViews(context.packageName, if (todo != null) R.layout.widget_layout else R.layout.widget_message).apply {
            setTextViewText(R.id.tv_start, "$done")
            setTextViewText(R.id.tv_end, "$total")
            if (total <= 1) {
                setInt(R.id.iv_lines, "setBackgroundColor", context.getColor(if (done <= 0) R.color.widgetLineGray else R.color.widgetLineRed))
                setImageViewResource(R.id.iv_lines, 0)
            } else {
                setInt(R.id.iv_lines, "setBackgroundColor", Color.TRANSPARENT)
                setImageViewBitmap(R.id.iv_lines, drawLines(context, widthPx(context, options), total, done))
            }
            if (todo == null) {
                setTextViewText(
                    R.id.tv_text,
                    if (total > 0) "🎉\n${t("allDoneTitle")}\n${t("allDoneText")}" else "🐝\n${t("noTodosTitle")}\n${t("noTodosText")}"
                )
                setOnClickPendingIntent(R.id.rl_message, broadcast(context, ACTION_REFRESH))
                return@apply
            }
            var text = isolateHashtags(clean(todo.text))
            if (!todo.time.isNullOrEmpty()) text = "${todo.time} $text"
            if (todo.frog) text = "🐸 $text"
            setTextViewText(R.id.tv_text, formatLinks(text))
            setOnClickPendingIntent(R.id.ib_done, broadcast(context, ACTION_DONE))
            setOnClickPendingIntent(R.id.ib_delete, broadcast(context, ACTION_DELETE))
            setOnClickPendingIntent(R.id.ib_skip, broadcast(context, ACTION_SKIP))
            setOnClickPendingIntent(R.id.ib_refresh, broadcast(context, ACTION_REFRESH))
            setOnClickPendingIntent(R.id.ib_add, openApp(context, addTodo = true))
            setViewVisibility(R.id.ib_skip, if (todo.frog || todo.skipped) View.GONE else View.VISIBLE)
        }
    }

    private fun widthPx(context: Context, options: Bundle): Int {
        val portrait = context.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
        val dp = options.getInt(if (portrait) AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH)
        return ((if (dp > 0) dp else 250) * context.resources.displayMetrics.density).toInt()
    }

    private fun broadcast(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
        context, action.hashCode(), Intent(context, WidgetProvider::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun openApp(context: Context, addTodo: Boolean): PendingIntent = PendingIntent.getActivity(
        context, if (addTodo) 1 else 0,
        Intent(context, MainActivity::class.java).putExtra("widget", addTodo).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private val noPrint = Regex("\\p{C}")
    private fun clean(text: String) = text.replace("\n", "<br>").replace(noPrint, "").replace("<br>", "\n")

    private val linkRegex = Regex("https?://\\S+")

    /** Links shortened to their domain like the RN widget did, still clickable */
    internal fun formatLinks(text: String): CharSequence {
        val links = ArrayList<Triple<Int, Int, String>>()
        val out = StringBuilder()
        var last = 0
        for (m in linkRegex.findAll(text)) {
            out.append(text, last, m.range.first)
            val link = m.value
            val start = link.indexOf("/") + 2
            val end = link.indexOf("/", start)
            val domain = when {
                end < 0 -> link.substring(start)
                end < link.length - 1 -> "${link.substring(start, end + 1)}..."
                else -> link.substring(start, end)
            }
            links.add(Triple(out.length, out.length + domain.length, link))
            out.append(domain)
            last = m.range.last + 1
        }
        if (links.isEmpty()) return text
        out.append(text, last, text.length)
        return SpannableString(out).apply { for ((s, e, url) in links) setSpan(URLSpan(url), s, e, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    }

    /** One dash per todo, or a progress bar when they don't fit (LinePainter.kt) */
    private fun drawLines(context: Context, width: Int, total: Int, done: Int): Bitmap {
        val red = context.getColor(R.color.widgetLineRed)
        val gray = context.getColor(R.color.widgetLineGray)
        val density = context.resources.displayMetrics.density
        val bitmap = Bitmap.createBitmap(width.coerceAtLeast(1), (2 * density).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val h = bitmap.height.toFloat()
        val w = bitmap.width.toFloat()
        val paint = Paint().apply { style = Paint.Style.STROKE; strokeWidth = h }
        val canvas = Canvas(bitmap)
        if (total > width / (8 * density) / 2) {
            val doneWidth = w * done / total
            paint.color = red
            canvas.drawLine(0f, h / 2, doneWidth, h / 2, paint)
            paint.color = gray
            canvas.drawLine(doneWidth, h / 2, w, h / 2, paint)
        } else {
            val stepWidth = w / (total * 10 - 1)
            for (i in 1..total) {
                paint.color = if (i <= done) red else gray
                canvas.drawLine((i - 1) * stepWidth * 10, h / 2, i * stepWidth * 10 - stepWidth, h / 2, paint)
            }
        }
        return bitmap
    }

    /** Widget buttons act on the current todo */
    internal suspend fun act(action: String) {
        val todo = Todos.forDay(todayTitle(), false).firstOrNull()
        if (todo != null) when (action) {
            ACTION_DONE -> {
                // Todos.complete without sounds, dialogs and confetti: no activity to show them in
                Todos.markCompleted(todo)
            }
            ACTION_DELETE -> {
                Db.updateTodo(todo) { it.deleted = true }
            }
            ACTION_SKIP -> if (Todos.isSkippable(todo)) Todos.skip(todo)
        }
        if (action == ACTION_REFRESH) Sync.request()
        refresh()
    }
}

class WidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        App.scope.launch(Dispatchers.IO) {
            try { Widget.update(context, manager, ids) } finally { pending.finish() }
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle?) =
        onUpdate(context, manager, intArrayOf(id))

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == ACTION_DONE || action == ACTION_DELETE || action == ACTION_SKIP || action == ACTION_REFRESH) {
            val pending = goAsync()
            App.scope.launch(Dispatchers.IO) {
                try { Widget.act(action) } finally { pending.finish() }
            }
        } else super.onReceive(context, intent)
    }
}
