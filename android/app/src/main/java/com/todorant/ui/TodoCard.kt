package com.todorant.ui

import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.AppState
import com.todorant.data.Db
import com.todorant.data.DelegateSection
import com.todorant.data.Settings
import com.todorant.data.Todo
import com.todorant.logic.TextPart
import com.todorant.logic.Todos
import com.todorant.logic.isTodoOld
import com.todorant.logic.linkify
import com.todorant.logic.todayTitle
import com.todorant.t

enum class CardType { current, planning, done, breakdown, delegation }

/** tag → color for coloring hashtags, provided at the root */
val LocalTagColors = compositionLocalOf<Map<String, String>> { emptyMap() }

/**
 * TodoCard from the RN app. [dragModifier] goes on the text: long-pressing it starts dragging (planning).
 */
@Composable
fun TodoCard(todo: Todo, type: CardType, modifier: Modifier = Modifier, dragModifier: Modifier = Modifier, showDivider: Boolean = true) {
    var expanded by rememberSaveable(todo.id) { mutableStateOf(false) }
    val swipeEnabled = Settings.swipeActions && !Onboarding.active && (type == CardType.current || type == CardType.planning)
    val context = LocalContext.current
    val threshold = with(LocalDensity.current) { 100.dp.toPx() }
    val state = rememberSwipeToDismissBoxState(positionalThreshold = { threshold })
    LaunchedEffect(state.currentValue) {
        val value = state.currentValue
        if (value == SwipeToDismissBoxValue.Settled) return@LaunchedEffect
        state.snapTo(SwipeToDismissBoxValue.Settled)
        if (value == SwipeToDismissBoxValue.StartToEnd) Todos.breakdownOrComplete(todo) else Todos.delete(todo)
    }
    LaunchedEffect(state.targetValue) {
        if (state.targetValue != SwipeToDismissBoxValue.Settled) {
            context.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }
    Column(modifier.ifTrue(type == CardType.current) { onboardingTarget(Target.CURRENT_TODO) }) {
        SwipeToDismissBox(
            state,
            enableDismissFromStartToEnd = swipeEnabled,
            enableDismissFromEndToStart = swipeEnabled,
            backgroundContent = {
                val toEnd = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
                Box(
                    Modifier.fillMaxSize().background(if (toEnd) Colors.success else Colors.destruct).padding(horizontal = 12.dp),
                    contentAlignment = if (toEnd) Alignment.CenterStart else Alignment.CenterEnd,
                ) {
                    if (toEnd) TIcon("done_outline_28--check", 36.dp, Color.White) else TIcon("delete_outline_28-iOS", 30.dp, Color.White)
                }
            },
        ) {
            Column(Modifier.fillMaxWidth().background(Colors.background).padding(vertical = 10.dp)) {
                if (todo.frogFails > 0) Row(Modifier.padding(start = 16.dp, bottom = 6.dp)) {
                    repeat(minOf(todo.frogFails, 5)) {
                        Box(Modifier.padding(end = 4.dp).size(8.dp, 6.dp).background(Colors.primary, RoundedCornerShape(20.dp)))
                    }
                }
                TodoCardBody(todo, type, dragModifier) { expanded = !expanded }
                if (type != CardType.breakdown && type != CardType.delegation && (expanded || type == CardType.current)) {
                    TodoCardActions(todo, type)
                }
                if (type == CardType.delegation) DelegateCardActions(todo)
            }
        }
        if (showDivider && type != CardType.current) Divider(Colors.divider, vertical = 0.dp)
    }
}

@Composable
private fun TodoCardBody(todo: Todo, type: CardType, dragModifier: Modifier, toggle: () -> Unit) {
    val isOld = type != CardType.done && type != CardType.delegation && isTodoOld(todo.monthAndYear, todo.date)
    val delegatorName = dbState(todo.delegatorId, initial = null as String?) {
        Db.userName(todo.delegatorId, isDelegator = true)
    }
    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().ifTrue(isOld) { background(Colors.oldTodoBackground) }) {
        if (!delegatorName.isNullOrEmpty() && type != CardType.delegation) {
            Text(
                "${t("delegate.from")}: $delegatorName" + if (todo.delegateAccepted == false) " ${todo.title}" else "",
                style = regularText, modifier = Modifier.clickable(onClick = toggle)
            )
        }
        TodoCardText(todo, isOld, type, dragModifier, toggle)
    }
}

@Composable
private fun TodoCardText(todo: Todo, isOld: Boolean, type: CardType, dragModifier: Modifier, toggle: () -> Unit) {
    val tagColors = LocalTagColors.current
    val extra = SpanStyle(color = Colors.text)
    val parts = remember(todo.text) { linkify(todo.text) }
    val text: AnnotatedString = buildAnnotatedString {
        if (isOld) withStyle(SpanStyle(color = Color(0xFFFF6347))) { append("! ") }
        if (todo.frog) withStyle(extra) { append("🐸 ") }
        if (!todo.time.isNullOrEmpty()) withStyle(extra) { append("${todo.time} ") }
        parts.forEachIndexed { i, p ->
            when (p) {
                is TextPart.Plain -> withStyle(SpanStyle(color = Colors.text)) { append(p.value) }
                is TextPart.Link, is TextPart.Hash -> {
                    val color = (p as? TextPart.Hash)?.let { tagColors[it.value.substring(1)]?.let(::hex) } ?: Colors.link
                    pushStringAnnotation("part", "$i")
                    withStyle(SpanStyle(color = color)) { append(p.value) }
                    pop()
                }
            }
        }
    }
    @Suppress("DEPRECATION")
    ClickableText(
        text, dragModifier.fillMaxWidth(),
        style = TextStyle(fontFamily = Fonts.textRegular, fontSize = 17.sp, lineHeight = 22.sp),
    ) { offset ->
        val index = text.getStringAnnotations("part", offset, offset).firstOrNull()?.item?.toInt()
        when (val part = index?.let { parts[it] }) {
            is TextPart.Link -> Ui.openUrl(part.url)
            is TextPart.Hash -> {
                if (part.value !in AppState.hash) {
                    AppState.hash.add(part.value)
                    Nav.go(Route.PLANNING)
                }
            }
            else -> if (type == CardType.breakdown || type == CardType.delegation) {
                Ui.copy(todo.text)
            } else toggle()
        }
    }
}

@Composable
private fun TodoCardActions(todo: Todo, type: CardType) {
    val locked = Onboarding.active
    val skippable = dbState(todo, initial = false) { type == CardType.current && Todos.isSkippable(todo) }
    Row(Modifier.fillMaxWidth().padding(top = 6.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Row {
            if (todo.encrypted) MIcon(MaterialIcons.Filled.VpnKey, Color.Gray, 15.dp)
            if (todo.skipped) MIcon(MaterialIcons.AutoMirrored.Filled.ArrowForward, Color.Gray, 15.dp)
            if (todo.repetitive) MIcon(MaterialIcons.Filled.Repeat, Color.Gray, 15.dp)
        }
        Box(Modifier.weight(1f))
        Row(Modifier.onboardingTarget(Target.TODO_ACTIONS), verticalAlignment = Alignment.CenterVertically) {
            IconBtn("delete_outline_28-iOS", Colors.destruct, disabled = locked) { Todos.delete(todo) }
            if (type == CardType.planning && todo.title != todayTitle() && !isTodoOld(todo.monthAndYear, todo.date)) {
                IconBtn("reply_outline_28-1") { Todos.moveToToday(todo) }
            }
            IconBtn("edit_outline_28", disabled = locked) { Nav.go(Route.edit(todo.id)) }
            if (type == CardType.current && skippable) {
                IconBtn("arrow_right_outline_28--forward", disabled = locked) { Ui.launch { Todos.skip(todo) } }
            }
            if (type == CardType.current || type == CardType.planning) {
                IconBtn(
                    "list_outline_28", modifier = Modifier.onboardingTarget(Target.BREAKDOWN_BUTTON),
                    disabled = locked && Onboarding.step != TutorialStep.Breakdown,
                ) { Nav.go(Route.breakdown(todo.id)) }
            }
            if (type == CardType.done) {
                IconBtn("arrow_uturn_right_outline_28", Colors.success, fullColor = true) { Todos.uncomplete(todo) }
            } else {
                IconBtn("done_outline_28--check", Colors.success, fullColor = true, disabled = locked) { Todos.breakdownOrComplete(todo) }
            }
        }
    }
}

@Composable
private fun DelegateCardActions(todo: Todo) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(todo.title, color = Colors.border)
        Box(Modifier.weight(1f))
        if (todo.delegateAccepted != true) {
            IconBtn("delete_outline_28-iOS", Colors.destruct) { Todos.delete(todo) }
            IconBtn("edit_outline_28") { Nav.go(Route.edit(todo.id)) }
        }
        if (AppState.delegateSection == DelegateSection.ToMe) {
            Text(
                t("accept"), style = regularText.copy(color = Colors.success),
                modifier = Modifier.clickable { Ui.launch { Todos.accept(todo) } }
            )
        }
    }
}

