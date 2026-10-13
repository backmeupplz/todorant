package com.todorant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.AppState
import com.todorant.data.Db
import com.todorant.data.Session
import com.todorant.data.Todo
import com.todorant.data.TodoSection
import com.todorant.logic.Todos
import com.todorant.logic.dateString
import com.todorant.sync.Sync
import com.todorant.t
import com.todorant.ui.CardType
import com.todorant.ui.Colors
import com.todorant.ui.Fonts
import com.todorant.ui.InfoButton
import com.todorant.ui.MIcon
import com.todorant.ui.MonthCalendar
import com.todorant.ui.Nav
import com.todorant.ui.Onboarding
import com.todorant.ui.Placeholder
import com.todorant.ui.PlusButton
import com.todorant.ui.Route
import com.todorant.ui.TIcon
import com.todorant.ui.Target
import com.todorant.ui.TodoCard
import com.todorant.ui.TodoHeader
import com.todorant.ui.Ui
import com.todorant.ui.dbState
import com.todorant.ui.onboardingTarget
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState
import java.time.YearMonth

private const val PAGE = 15

private fun key(item: Any) = if (item is Todo) "t:${item.id}" else "h:$item"

/**
 * Day titles followed by their todos, like the RN DraggableFlatList data. Month-only todos sort together with the
 * 1st of that month (same exact date), so they're grouped by title instead of trusting the order — the RN app
 * showed them under the wrong header.
 */
private fun flatten(todos: List<Todo>): List<Any> =
    todos.groupBy { it.title }.flatMap { (title, dayTodos) -> listOf<Any>(title) + dayTodos }

@Composable
fun PlanningScreen() {
    val completed = AppState.todoSection == TodoSection.completed
    val search = AppState.searchQuery.ifEmpty { AppState.hash.joinToString(" ") }
    var limit by remember(completed) { mutableIntStateOf(PAGE) }
    val todos = dbState(completed, search, limit, Session.user?.id, initial = null as List<Todo>?) { Todos.planning(completed, search, limit) }
    var calendarMonth by rememberSaveable { mutableStateOf(YearMonth.now()) }
    val planningRequired = dbState(Session.user?.id, rememberTodayTitle(), initial = false) { Todos.oldCount() > 0 } && !Onboarding.active
    val items = remember(todos) { flatten(todos ?: emptyList()) }
    // Local copy so items move while dragging; the database version comes back after the drop
    var list by remember { mutableStateOf(items) }
    var dragging by remember { mutableStateOf(false) }
    var dragFrom by remember { mutableIntStateOf(-1) }
    var dragBefore by remember { mutableStateOf(emptyList<Any>()) }
    LaunchedEffect(items) { if (!dragging) list = items }
    val canDrag = !completed && !Onboarding.active

    val listState = rememberLazyListState()
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        // Nothing can go above the first day header
        if (from.index == 0 || to.index == 0) return@rememberReorderableLazyListState
        list = list.toMutableList().apply { add(to.index, removeAt(from.index)) }
    }
    // Load more when the end is reached (RN onEndReached + offset)
    LaunchedEffect(listState, todos) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }.collect { last ->
            val loaded = todos ?: return@collect
            if (last != null && last >= list.size - 3 && loaded.size >= limit) limit += PAGE
        }
    }

    fun startDrag(item: Any) {
        dragging = true
        dragBefore = list
        dragFrom = list.indexOfFirst { key(it) == key(item) }
    }

    fun stopDrag(item: Any) {
        val to = list.indexOfFirst { key(it) == key(item) }
        val result = if (dragFrom >= 0 && to >= 0) planningDrop(dragFrom, to, dragBefore) else PlanningDrop(emptyList())
        dragging = false
        if (result.updates.isEmpty()) list = items
        Db.saveTodos(result.updates)
        result.breakdown?.let { todo ->
            Ui.alert(
                t("error"), t("breakdownRequest"),
                listOf(t("cancel") to {}, t("breakdownButton") to { Nav.go(Route.breakdown(todo.id)) })
            )
        }
        Sync.request(Sync.Kind.Todo)
    }

    Box(Modifier.fillMaxSize().background(Colors.background)) {
        Column(Modifier.fillMaxSize()) {
            PlanningHeader(completed)
            if (planningRequired && !completed) {
                Text(t("planningText"), color = Color.White, modifier = Modifier.fillMaxWidth().background(Color(0xFF1E90FF)).padding(12.dp))
            }
            if (AppState.calendarEnabled) {
                // Keeps the shown month while the calendar is toggled, like RN's currentMonth/currentYear
                MonthCalendar(calendarMonth, onDayClick = { Nav.go(Route.add(date = it.dateString())) }, onMonthChange = { calendarMonth = it })
            }
            if (todos != null && list.isEmpty()) {
                Placeholder("👀", t("noTodosExistTitle"), t("noTodosExistText"))
            }
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 140.dp)) {
                items(list, key = ::key) { item ->
                    ReorderableItem(reorderState, key(item), enabled = canDrag) { isDragging ->
                        val handle = Modifier.longPressDraggableHandle(
                            enabled = canDrag,
                            onDragStarted = { startDrag(item) },
                            onDragStopped = { stopDrag(item) },
                        )
                        val lift = Modifier.graphicsLayer { if (isDragging) { scaleX = 1.03f; scaleY = 1.03f } }
                        if (item is Todo) {
                            TodoCard(
                                item, if (completed) CardType.done else CardType.planning,
                                modifier = lift.background(Colors.background), dragModifier = handle,
                            )
                        } else {
                            Box(lift) {
                                TodoHeader(item as String, date = true, plusEnabled = !Onboarding.active, labelModifier = handle)
                            }
                        }
                    }
                }
            }
        }
        PlusButton(enabled = !Onboarding.active)
    }
}

@Composable
private fun PlanningHeader(completed: Boolean) {
    val locked = Onboarding.active
    Row(
        Modifier.fillMaxWidth().background(Colors.background).windowInsetsPadding(WindowInsets.statusBars).height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(56.dp), contentAlignment = Alignment.Center) {
            if (AppState.hash.isEmpty()) MIcon(
                if (AppState.searchEnabled) MaterialIcons.Filled.Close else MaterialIcons.Filled.Search, Colors.text.copy(alpha = 0.5f),
                onClick = {
                    if (!locked) {
                        AppState.searchQuery = ""
                        AppState.searchEnabled = !AppState.searchEnabled
                    }
                },
            )
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            when {
                AppState.hash.isNotEmpty() -> Text(
                    AppState.hash.joinToString(" "), color = Colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(end = 24.dp)
                )
                AppState.searchEnabled -> PlanningSearchField()
                else -> PlanningSegment(completed)
            }
        }
        Box(Modifier.width(56.dp), contentAlignment = Alignment.CenterEnd) {
            when {
                AppState.hash.isNotEmpty() -> MIcon(
                    MaterialIcons.Filled.Close, Colors.text.copy(alpha = 0.5f), modifier = Modifier.padding(end = 12.dp),
                    onClick = { AppState.hash.clear() },
                )
                !completed -> TIcon(
                    "calendar_outline_28--event", 28.dp, Colors.text,
                    Modifier.padding(end = 12.dp).alpha(0.5f).clip(RoundedCornerShape(50))
                        .clickable(enabled = !locked) { AppState.calendarEnabled = !AppState.calendarEnabled },
                )
                else -> InfoButton("infoPlanning")
            }
        }
    }
}

@Composable
private fun PlanningSearchField() {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BasicTextField(
        AppState.searchQuery, { AppState.searchQuery = it },
        singleLine = true,
        textStyle = TextStyle(color = Colors.text, fontSize = 17.sp),
        cursorBrush = SolidColor(Colors.primary),
        modifier = Modifier.fillMaxWidth().focusRequester(focus),
        decorationBox = { inner ->
            if (AppState.searchQuery.isEmpty()) Text("${t("search")}...", color = Colors.placeholder, fontSize = 17.sp)
            inner()
        },
    )
}

/** Android-styled SegmentedControl: planning / completed */
@Composable
private fun PlanningSegment(completed: Boolean) {
    Row(
        Modifier.fillMaxWidth().onboardingTarget(Target.PLANNING_SEGMENT).clip(RoundedCornerShape(8.dp)).background(Colors.segmentBackground).padding(2.dp)
    ) {
        for ((section, label) in listOf(TodoSection.planning to t("planning"), TodoSection.completed to t("completed"))) {
            val selected = (section == TodoSection.completed) == completed
            Text(
                label, fontFamily = Fonts.roundedRegular, fontSize = 14.sp, textAlign = TextAlign.Center, maxLines = 1,
                color = if (selected) Color.White else Colors.text,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(6.dp)).background(if (selected) Colors.segmentTint else Color.Transparent)
                    .clickable { AppState.todoSection = section }.padding(vertical = 6.dp),
            )
        }
    }
}
