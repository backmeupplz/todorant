package com.todorant.logic

import com.todorant.data.Db
import com.todorant.data.Db.saveTag
import com.todorant.data.Db.saveTodo
import com.todorant.data.Hero
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.Tag
import com.todorant.data.Todo
import com.todorant.sync.Sync
import com.todorant.t
import com.todorant.ui.Effects
import com.todorant.ui.Nav
import com.todorant.ui.Route
import com.todorant.ui.Sounds
import com.todorant.ui.Ui

/** Queries from TodoStore / PlanningVM, with delegation users referenced by server id */
object Todos {
    private val me get() = Session.user?.id ?: ""

    private fun dateWhere(title: String) =
        if (title.length == 10) "date = ?" else "(date = '' OR date IS NULL)"

    /** Bound arguments for [dateWhere] */
    private fun dateArgs(title: String) = if (title.length == 10) arrayOf(title.substring(8, 10)) else emptyArray()

    /** Todos from delegators we're no longer connected to stay hidden (the RN app deleted them locally on pull) */
    private const val KNOWN_DELEGATOR = "(delegator_id IS NULL OR delegator_id = ? OR delegator_id IN " +
        "(SELECT server_id FROM users WHERE is_delegator = 1 AND is_deleted = 0))"

    /** Own todos and accepted todos delegated to me for a day (getTodos) */
    fun forDay(title: String, completed: Boolean): List<Todo> = Db.todos(
        "${Db.UNDELETED} AND is_delegate_accepted IS NOT 0 AND is_completed = ? AND month_and_year = ? AND ${dateWhere(title)} AND " +
            "((is_delegate_accepted IS NOT 1 AND delegator_id IS NULL) OR (is_delegate_accepted = 1 AND delegator_id IS NOT ?)) AND $KNOWN_DELEGATOR",
        arrayOf(if (completed) "1" else "0", title.take(7)) + dateArgs(title) + arrayOf(me, me), "is_frog DESC, \"order\" ASC"
    )

    /** todosForDate: everything on a day, used for ordering */
    fun allForDay(title: String, completed: Boolean? = null): List<Todo> = Db.todos(
        "${Db.UNDELETED} AND is_delegate_accepted IS NOT 0 AND month_and_year = ? AND ${dateWhere(title)}" +
            (completed?.let { " AND is_completed = ${if (it) 1 else 0}" } ?: ""),
        arrayOf(title.take(7)) + dateArgs(title), "\"order\" ASC"
    )

    /** Uncompleted todos before today — makes planning required */
    fun oldCount(): Int = Db.count(
        "todos", "${Db.UNDELETED} AND is_completed = 0 AND exact_date_at < ? AND (user_id IS NULL OR user_id = ?) AND " +
            "(delegator_id IS NULL OR is_delegate_accepted = 1) AND $KNOWN_DELEGATOR",
        arrayOf((exactDate(todayTitle()) ?: 0).toString(), me, me)
    )

    private const val PLANNING_WHERE = "${Db.UNDELETED} AND is_completed = ? AND (user_id IS NULL OR user_id = ?) AND " +
        "(delegator_id IS NULL OR is_delegate_accepted = 1) AND $KNOWN_DELEGATOR"

    /** Planning/completed lists, optionally filtered by a search string */
    fun planning(completed: Boolean, search: String?, limit: Int): List<Todo> {
        val like = search?.takeIf { it.isNotEmpty() }?.let { "%${sanitizeLike(it)}%" }
        return Db.todos(
            PLANNING_WHERE + if (like != null) " AND text LIKE ?" else "",
            listOfNotNull(if (completed) "1" else "0", me, me, like).toTypedArray(),
            "exact_date_at ${if (completed) "DESC" else "ASC"}, is_frog DESC, \"order\" ASC", limit
        )
    }

    fun planningCount(completed: Boolean) = Db.count("todos", PLANNING_WHERE, arrayOf(if (completed) "1" else "0", me, me))

    /** getDelegationTodos */
    fun delegated(byMe: Boolean, completed: Boolean = false): List<Todo> = Db.todos(
        "${Db.UNDELETED} AND delegator_id IS NOT NULL AND is_completed = ? AND " +
            if (byMe) "delegator_id = ?" else "is_delegate_accepted IS NOT ${if (completed) 0 else 1} AND user_id = ?",
        arrayOf(if (completed) "1" else "0", me), "exact_date_at ASC, \"order\" ASC"
    )

    // region Actions (TodoCardVM)

    fun isSkippable(todo: Todo) = !todo.frog && todo.time.isNullOrEmpty() && allForDay(todo.title, todo.completed).size > 1

    suspend fun skip(todo: Todo) {
        val neighbours = allForDay(todo.title, todo.completed)
        val toUpdate = ArrayList<Todo>()
        var startOffsetting = false
        var offset = 0
        var foundValidNeighbour = false
        for (n in neighbours) {
            if (n.key == todo.key) { startOffsetting = true; continue }
            if (startOffsetting) {
                offset++
                if (!n.skipped) {
                    n.order -= offset
                    toUpdate.add(n)
                    foundValidNeighbour = true
                    break
                }
            }
        }
        if (!foundValidNeighbour) neighbours.forEachIndexed { i, n -> if (i > 0) { n.order--; toUpdate.add(n) } }
        todo.order += offset
        todo.skipped = true
        toUpdate.removeAll { it.key == todo.key }
        toUpdate.add(todo)
        Db.saveTodos(toUpdate)
        fixOrder(listOf(todo.title), timeTodosToYield = listOf(todo))
    }

    fun moveToToday(todo: Todo) {
        val today = todayWithStartOfDay()
        // RN crashed here when today had no todos yet
        val lastOrder = allForDay(today.dateString()).lastOrNull()?.order ?: -1.0
        Db.updateTodo(todo) {
            it.order = lastOrder + 1
            it.date = today.day()
            it.monthAndYear = today.monthAndYear()
            it.exactDate = exactDate(it.title)
        }
        Sync.request(Sync.Kind.Todo)
    }

    fun delete(todo: Todo) {
        val doDelete = {
            Db.updateTodo(todo) { it.deleted = true }
            Sync.request(Sync.Kind.Todo)
        }
        if (Settings.askBeforeDelete) {
            val text = if (todo.text.length > 50) "${todo.text.take(50)}..." else todo.text
            Ui.confirm("${t("deleteTodo")} \"$text\"?", t("delete")) { doDelete() }
        } else doDelete()
    }

    suspend fun accept(todo: Todo) {
        if (todo.date.isNullOrEmpty() && todo.monthAndYear.isNullOrEmpty()) {
            Nav.go(Route.edit(todo.id))
            return
        }
        Db.updateTodo(todo) { it.delegateAccepted = true }
        fixOrder(listOf(todo.title))
    }

    fun uncomplete(todo: Todo) {
        Db.updateTodo(todo) { it.completed = false }
        Sync.request(Sync.Kind.Todo)
    }

    fun breakdownOrComplete(todo: Todo) {
        if (todo.repetitive) {
            Ui.alert(
                t("breakdownMessage.title"), t("breakdownMessage.text"),
                listOf(
                    t("cancel") to {},
                    t("breakdownMessage.complete") to { Ui.launch { complete(todo) } },
                    t("breakdownButton") to { Nav.go(Route.breakdown(todo.id)) },
                )
            )
        } else Ui.launch { complete(todo) }
    }

    suspend fun complete(todo: Todo) {
        if (todo.frog) Sounds.frogComplete() else {
            if (forDay(todayTitle(), false).any { it.frog }) Ui.message(t("frogsAlert.title"), t("frogsAlert.text"))
            Sounds.taskComplete()
        }
        incrementHeroPoints()
        Tags.incrementEpicPoints(todo.text, sync = false)
        Db.updateTodo(todo) { it.completed = true }
        Session.numberOfTodosCompleted++
        Effects.confetti()
        checkDayCompletion()
        Sync.request(Sync.Kind.Todo)
    }

    fun incrementHeroPoints(sync: Boolean = true) {
        Hero.points++
        Hero.updatedAt = System.currentTimeMillis()
        if (sync) Sync.request(Sync.Kind.Hero)
    }

    // endregion

    // region Day completion (dayCompleteRoutine.ts)

    fun shouldShowDayCompletion(): Boolean {
        if (!Settings.soundOn && !Settings.endOfDaySoundOn) return false
        val today = allForDay(todayTitle())
        return today.isNotEmpty() && today.all { it.completed }
    }

    fun checkDayCompletion() {
        if (shouldShowDayCompletion()) {
            Effects.dayComplete()
            Sounds.dayComplete()
        }
    }

    // endregion

    // region fixOrder (fixOrder.ts)

    suspend fun fixOrder(
        titles: Collection<String>,
        addTodosOnTop: List<Todo> = emptyList(),
        addTodosToBottom: List<Todo> = emptyList(),
        timeTodosToYield: List<Todo> = emptyList(),
        sync: Boolean = true,
    ) {
        val onTop = addTodosOnTop.map { it.key }.toSet()
        val onBottom = addTodosToBottom.map { it.key }.toSet()
        val yieldIds = timeTodosToYield.map { it.key }.toSet()
        val toUpdate = ArrayList<Todo>()
        for (title in titles.toSet()) {
            val completed = sortForFix(allForDay(title, true), onTop, onBottom)
            completed.forEachIndexed { i, todo -> if (todo.order != i.toDouble()) { todo.order = i.toDouble(); toUpdate.add(todo) } }
            val uncompleted = sortForFix(allForDay(title, false), onTop, onBottom)
            if (Settings.preserveOrderByTime == true) {
                while (!isTimeSorted(uncompleted)) fixOneTodoTime(uncompleted, yieldIds)
            }
            uncompleted.forEachIndexed { i, todo -> if (todo.order != i.toDouble()) { todo.order = i.toDouble(); toUpdate.add(todo) } }
        }
        Db.saveTodos(toUpdate)
        if (sync) Sync.request(Sync.Kind.Todo)
    }

    internal fun sortForFix(todos: List<Todo>, onTop: Set<String>, onBottom: Set<String>): MutableList<Todo> {
        // Stable sort: on-top group, then the rest by order, then on-bottom group
        fun group(t: Todo) = when (t.key) { in onTop -> 0; in onBottom -> 2; else -> 1 }
        return todos.sortedWith(compareBy<Todo>({ group(it) }, { it.order })).toMutableList()
    }

    /** null for malformed times (parseInt gave NaN in RN, which never compared as smaller) */
    internal fun minutes(time: String) = time.split(":").let { p -> p.getOrNull(0)?.toIntOrNull()?.let { h -> p.getOrNull(1)?.toIntOrNull()?.let { h * 60 + it } } }

    internal fun isTimeSorted(todos: List<Todo>): Boolean {
        var last: Int? = null
        for (t in todos) {
            val m = t.time?.let(::minutes) ?: continue
            if (last != null && m < last) return false
            last = m
        }
        return true
    }

    internal fun fixOneTodoTime(todos: MutableList<Todo>, yieldIds: Set<String>) {
        var time: Int? = null
        var prevIndex: Int? = null
        for ((i, todo) in todos.withIndex()) {
            val m = todo.time?.let(::minutes) ?: continue
            if (time != null && prevIndex != null && m < time) {
                if (todo.key in yieldIds) {
                    // Current should be moved
                    todos.removeAt(i)
                    todos.add(prevIndex, todo)
                } else {
                    // Previous todo should be moved
                    val prev = todos.removeAt(prevIndex)
                    todos.add(i, prev)
                }
                return
            }
            time = m
            prevIndex = i
        }
    }

    // endregion

    /** TodoStore.recalculateExactDates */
    fun recalculateExactDates() {
        val all = Db.todos()
        Db.write { all.forEach { it.exactDate = exactDate(it.title); saveTodo(it, local = false) } }
    }
}

object Tags {
    /** tag text → color, for coloring hashtags */
    fun colorMap(): Map<String, String> = Db.undeletedTags().mapNotNull { t -> t.color?.takeIf { it.isNotEmpty() }?.let { t.tag to it } }.toMap()

    /** Tags suggested while typing (TodoVM.tags) */
    fun suggestions(text: String, showMore: Boolean): List<Tag> {
        if (text.endsWith("#")) return Db.undeletedTags()
        val match = Regex("#[\\u0400-\\u04FFa-zA-Z_0-9]+$").find(text)
            ?: return if (Settings.showMoreByDefault == true || showMore) Db.undeletedTags() else emptyList()
        return Db.undeletedTags("tag LIKE ?", arrayOf("%${sanitizeLike(match.value.substring(1))}%"))
    }

    fun completeEpic(epic: Tag) {
        Db.updateTag(epic) {
            it.epic = false; it.epicPoints = 0; it.epicGoal = 0; it.epicCompleted = true
        }
        Sync.request(Sync.Kind.Tag)
    }

    fun incrementEpicPoints(text: String, sync: Boolean = true) {
        val tags = hashtags(text).toSet()
        val epics = Db.epics().filter { it.tag in tags && (it.epicGoal ?: 0) > 0 && (it.epicPoints ?: 0) < it.epicGoal!! }
        if (epics.isEmpty()) return
        Db.write { epics.forEach { it.epicPoints = (it.epicPoints ?: 0) + 1; saveTag(it) } }
        if (sync) Sync.request(Sync.Kind.Tag)
    }

    /** Counts hashtag uses and creates new tags */
    fun addTags(texts: List<String>, sync: Boolean = true) {
        val counts = texts.flatMap { hashtags(it) }.groupingBy { it }.eachCount()
        if (counts.isEmpty()) return
        val existing = Db.undeletedTags()
        Db.write {
            for (tag in existing) counts[tag.tag]?.let { tag.numberOfUses += it; saveTag(tag) }
            val known = existing.map { it.tag }.toSet()
            for (name in counts.keys - known) saveTag(Tag(tag = name, epicPoints = 0))
        }
        if (sync) Sync.request(Sync.Kind.Tag)
    }
}
