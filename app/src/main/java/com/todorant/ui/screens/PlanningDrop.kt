package com.todorant.ui.screens

import com.todorant.data.Todo
import com.todorant.logic.exactDate
import com.todorant.logic.isTodoOld

/** What a drop in the planning list changes: todos to save, or a todo that failed too often and needs a breakdown */
class PlanningDrop(val updates: List<Todo>, val breakdown: Todo? = null)

/**
 * onDragEnd() from PlanningContent.tsx. [before] is the flattened list of day titles (String) and todos
 * before the drag; the item at [from] was dropped at [to]. Returned todos are modified copies.
 *
 * Fixed RN bugs: dragging a day header down crashed (it read a todo as a title), month headers set date to ""
 * (rejected by the server), dropping a todo last in a day next to a frog crashed, and a moved todo took its date
 * from a neighbour instead of the day it was dropped into.
 */
fun planningDrop(
    from: Int,
    to: Int,
    before: List<Any>,
    isOld: (Todo) -> Boolean = { isTodoOld(it.monthAndYear, it.date) },
): PlanningDrop {
    if (from == to) return PlanningDrop(emptyList())
    val after = before.toMutableList().apply { add(to, removeAt(from)) }
    fun closestSection(index: Int, list: List<Any>) = (index downTo 0).firstOrNull { list[it] is String } ?: 0
    val sectionFrom = closestSection(from, before)
    val sectionTo = closestSection(to, after)

    val moved = before[from]
    if (moved is Todo) {
        val fromBottomToTop = from > to
        val toTodo = before.getOrNull(to) as? Todo
        val near = before.getOrNull(if (fromBottomToTop) to - 1 else to + 1)
        val nearTodo = near as? Todo
        var secondOrder = nearTodo?.order ?: -1.0
        if (nearTodo?.frog == true && !moved.frog) secondOrder = -1.0
        // Dropped right below a day header: there's no todo at `to` (undefined order in the RN app)
        var average = if (toTodo == null) {
            if (!fromBottomToTop) secondOrder - 1 else secondOrder + 1
        } else (toTodo.order + secondOrder) / 2
        if (toTodo != null) {
            val next = before.getOrNull(to + 1)
            if ((!fromBottomToTop && next is String) || next == null) average = toTodo.order + 1
            if (near != null && toTodo.frog && nearTodo?.frog != true && before.getOrNull(to - 1) !is String) average = toTodo.order + 1
        }
        val todo = moved.copy(order = average)
        if (sectionFrom == sectionTo) return PlanningDrop(listOf(todo))
        // Moved to another day
        val title = after[sectionTo] as? String ?: return PlanningDrop(emptyList())
        if (isOld(moved)) {
            if (moved.frogFails >= 3) return PlanningDrop(emptyList(), breakdown = moved)
            if (moved.frogFails >= 1) todo.frog = true
            todo.frogFails++
        }
        todo.redate(title)
        return PlanningDrop(listOf(todo))
    }

    // A day header was moved: todos now under it belong to its day; sections that got new todos are renumbered
    val changed = HashSet<String>()
    var section: String? = null
    for (item in after) {
        if (item is String) section = item
        else if (item is Todo && section != null && item.title != section) changed.add(section)
    }
    val updates = ArrayList<Todo>()
    section = null
    var order = 0
    for (item in after) {
        if (item is String) { section = item; order = 0; continue }
        val todo = item as Todo
        if (section != null && section in changed) {
            val copy = todo.copy(order = order.toDouble())
            if (todo.title != section) copy.redate(section)
            if (copy != todo) updates.add(copy)
        }
        order++
    }
    return PlanningDrop(updates)
}

private fun Todo.redate(title: String) {
    monthAndYear = title.take(7)
    date = if (title.length == 10) title.substring(8, 10) else null
    exactDate = exactDate(title)
}
