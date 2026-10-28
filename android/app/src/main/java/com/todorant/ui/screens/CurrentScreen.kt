package com.todorant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.AppState
import com.todorant.data.Db
import com.todorant.data.TagEntity
import com.todorant.data.Session
import com.todorant.data.Tag
import com.todorant.logic.Tags
import com.todorant.logic.Todos
import com.todorant.logic.isolate
import com.todorant.logic.todayTitle
import com.todorant.t
import com.todorant.ui.CardType
import com.todorant.ui.Colors
import com.todorant.ui.Fonts
import com.todorant.ui.IconBtn
import com.todorant.ui.LargeTitleScreen
import com.todorant.ui.Nav
import com.todorant.ui.Onboarding
import com.todorant.ui.Placeholder
import com.todorant.ui.PlusButton
import com.todorant.ui.ProgressView
import com.todorant.ui.Route
import com.todorant.ui.SegmentedProgressView
import com.todorant.ui.Target
import com.todorant.ui.TodoCard
import com.todorant.ui.TutorialStep
import com.todorant.ui.dbState
import com.todorant.ui.hex
import com.todorant.ui.onboardingTarget
import kotlinx.coroutines.delay
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

/** Today's title, following the "start time of day" setting (ObservableNow in the RN app) */
@Composable
fun rememberTodayTitle(): String = produceState(todayTitle()) {
    while (true) {
        delay(1000)
        value = todayTitle()
    }
}.value

@Composable
fun CurrentScreen() {
    val today = rememberTodayTitle()
    val user = Session.user?.id
    val uncompleted = dbState(today, user, initial = emptyList()) { Todos.forDay(today, false) }
    val completedCount = dbState(today, user, initial = 0) { Todos.forDay(today, true).size }
    val dbEpics = dbState(initial = emptyList()) { Db.epics() }
    // Local copy so dragging can reorder before it's saved
    var epics by remember { mutableStateOf(dbEpics) }
    var dragging by remember { mutableStateOf(false) }
    LaunchedEffect(dbEpics) { if (!dragging) epics = dbEpics }
    val total = uncompleted.size + completedCount

    val listState = rememberLazyListState()
    val reorderState = rememberReorderableLazyListState(listState) { from, to ->
        val fromIndex = epics.indexOfFirst { epicKey(it) == from.key }
        val toIndex = epics.indexOfFirst { epicKey(it) == to.key }
        if (fromIndex >= 0 && toIndex >= 0) epics = epics.toMutableList().apply { add(toIndex, removeAt(fromIndex)) }
    }

    Box(Modifier.fillMaxSize()) {
        LargeTitleScreen(t("current"), "infoCurrent", showsHeroButton = true, state = listState, bottomPadding = 100.dp) {
            if (epics.isNotEmpty()) item("epicsTop") { Box(Modifier.padding(top = 16.dp)) }
            for (epic in epics) {
                item(epicKey(epic)) {
                    ReorderableItem(reorderState, epicKey(epic)) { isDragging ->
                        EpicProgress(
                            epic,
                            Modifier.background(if (isDragging) Colors.cardBackground else Colors.background).longPressDraggableHandle(
                                onDragStarted = { dragging = true },
                                onDragStopped = {
                                    dragging = false
                                    saveEpicOrder(epics)
                                },
                            ),
                        )
                    }
                }
            }
            if (total > 0) item("progress") { SegmentedProgressView(completedCount, total) }
            uncompleted.firstOrNull()?.let { todo ->
                item("current") { TodoCard(todo, CardType.current) }
            }
            if (total > 0 && uncompleted.isEmpty()) item("allDone") { Placeholder("🎉", t("allDoneTitle"), t("allDoneText"), topMargin = 0.dp, margin = 0.dp) }
            if (total == 0) item("noTodos") { Placeholder("🐝", t("noTodosTitle"), t("noTodosText"), topMargin = 32.dp) }
        }
        PlusButton(
            Modifier.onboardingTarget(Target.PLUS_BUTTON),
            enabled = !Onboarding.active || Onboarding.step == TutorialStep.AddTask,
        )
    }
}

private fun epicKey(epic: Tag) = "epic-${epic.id}"

private fun saveEpicOrder(epics: List<Tag>) {
    epics.forEachIndexed { i, epic -> epic.epicOrder = i }
    Db.save(TagEntity, epics)
}

@Composable
private fun EpicText(text: String, color: String?, onClick: (() -> Unit)? = null) {
    Text(
        text, fontFamily = Fonts.roundedRegular, fontSize = 22.sp,
        color = color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.primary,
        modifier = Modifier.padding(horizontal = 16.dp).let { if (onClick != null) it.clickable(onClick = onClick) else it },
    )
}

@Composable
private fun EpicProgress(epic: Tag, modifier: Modifier) {
    val points = epic.epicPoints ?: 0
    val goal = epic.epicGoal ?: 0
    val color = epic.color?.takeIf { it.isNotEmpty() }
    Row(modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        EpicText("$points", color)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            EpicText(isolate("#${epic.tag}"), color) {
                if ("#${epic.tag}" !in AppState.hash) AppState.hash.add("#${epic.tag}")
                Nav.go(Route.PLANNING)
            }
            // RN showed (points || 1) / goal, so an epic with 0 points looked started
            ProgressView(
                if (goal > 0) points.toFloat() / goal else 0f,
                color?.let(::hex) ?: Colors.primary, Colors.progressBarBackground,
            )
        }
        // Raw comparison like RN: an epic without a goal shows the goal, not the complete button
        if (epic.epicPoints != epic.epicGoal) EpicText("$goal", color)
        else Box(Modifier.padding(end = 8.dp)) {
            IconBtn("done_outline_28--check", color?.let(::hex) ?: Colors.destruct) { Tags.completeEpic(epic) }
        }
    }
}
