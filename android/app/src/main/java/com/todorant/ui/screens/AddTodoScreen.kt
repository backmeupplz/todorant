package com.todorant.ui.screens

import android.app.TimePickerDialog
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.BuildConfig
import com.todorant.I18n
import com.todorant.data.Db
import com.todorant.data.Hero
import com.todorant.data.TodoEntity
import com.todorant.data.Ids
import com.todorant.data.DelegationUser
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.Todo
import com.todorant.logic.Tags
import com.todorant.logic.Todos
import com.todorant.logic.capitalizeSentence
import com.todorant.logic.dateString
import com.todorant.logic.day
import com.todorant.logic.hashtags
import com.todorant.logic.hhmm
import com.todorant.logic.isToday
import com.todorant.logic.isTodoOld
import com.todorant.logic.monthAndYear
import com.todorant.logic.parseTime
import com.todorant.logic.parseTitle
import com.todorant.logic.todayWithStartOfDay
import com.todorant.t
import com.todorant.ui.CardType
import com.todorant.ui.Colors
import com.todorant.ui.DialogSpec
import com.todorant.ui.Divider
import com.todorant.ui.Effects
import com.todorant.ui.Fonts
import com.todorant.ui.IconBtn
import com.todorant.ui.InfoButton
import com.todorant.ui.MIcon
import com.todorant.ui.MonthCalendar
import com.todorant.ui.Nav
import com.todorant.ui.Onboarding
import com.todorant.ui.Sounds
import com.todorant.ui.StackScreen
import com.todorant.ui.TIcon
import com.todorant.ui.Target
import com.todorant.ui.TodoCard
import com.todorant.ui.TodorantSwitch
import com.todorant.ui.TutorialStep
import com.todorant.ui.Ui
import com.todorant.ui.brandGradient
import com.todorant.ui.dbState
import com.todorant.ui.hex
import com.todorant.ui.ifTrue
import com.todorant.ui.onboardingTarget
import kotlinx.coroutines.launch
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.TextStyle as DateTextStyle
import kotlin.math.roundToInt

enum class AddMode { add, edit, breakdown }

/** Lets the tutorial overlay's buttons save the todos while this screen is shown */
object AddTodoActions {
    var save: () -> Unit = {}
}

private const val FONT_SIZE = 18
private val verticalSpacing = 8.dp
private val hashRegex = Regex("#[\\u0400-\\u04FFa-zA-Z_0-9]+$")

/** One todo form (TodoVM) */
class TodoVM {
    val key = Ids.new()
    val focus = FocusRequester()

    var value by mutableStateOf(TextFieldValue(""))
    var text: String
        get() = value.text
        set(v) { value = TextFieldValue(v, TextRange(v.length)) }
    var completed by mutableStateOf(false)
    var frog by mutableStateOf(false)
    var monthAndYear by mutableStateOf<String?>(null)
    var date by mutableStateOf<String?>(null)
    var time by mutableStateOf<String?>(null)
    var repetitive by mutableStateOf(false)
    var delegate by mutableStateOf<DelegationUser?>(null)
    var delegateAccepted by mutableStateOf<Boolean?>(null)
    var showDatePicker by mutableStateOf(false)
    var showMonthAndYearPicker by mutableStateOf(false)
    var showMore by mutableStateOf(false)
    var addOnTop by mutableStateOf(false)
    var collapsed by mutableStateOf(false)
    var editedTodo: Todo? = null
        private set

    /** Bumped to shake the invalid fields */
    var shake by mutableIntStateOf(0)

    val isValid get() = text.isNotEmpty() && (delegate != null || monthAndYear != null)

    /** YYYY-MM-DD when a day is selected */
    val datePickerValue get() = monthAndYear?.let { m -> parseTitle(if (date.isNullOrEmpty()) m else "$m-$date")?.dateString() }

    fun setDatePickerValue(day: LocalDate) {
        monthAndYear = day.monthAndYear()
        date = day.day()
    }

    init {
        val step = Onboarding.step
        if (Onboarding.active && (step == TutorialStep.AddText || step == TutorialStep.AddTask || Onboarding.savedStep == TutorialStep.AddText)) {
            text = t("onboarding.todoText")
        }
        if (Onboarding.active || Settings.showTodayOnAddTodo == true) setDatePickerValue(todayWithStartOfDay())
        if (Settings.newTodosGoFirst == true) addOnTop = true
    }

    fun edit(todo: Todo) {
        editedTodo = todo
        text = todo.text
        completed = todo.completed
        frog = todo.frog
        monthAndYear = todo.monthAndYear
        date = todo.date
        time = todo.time
        delegateAccepted = todo.delegateAccepted
        repetitive = todo.repetitive
        showMore = true
    }

    fun applyTag(tag: String) {
        val (newText, cursor) = applyTagText(text, value.selection.start, tag)
        value = TextFieldValue(newText, TextRange(cursor))
    }
}

/**
 * TodoVM.applyTag: inserts "#tag" at the cursor, completing a hashtag being typed at the end of the text.
 * Returns the new text and cursor. The RN version left a double space when the cursor was at the end.
 */
internal fun applyTagText(text: String, cursor: Int, tag: String): Pair<String, Int> {
    val c = cursor.coerceIn(0, text.length)
    var before = text.substring(0, c)
    val rest = text.substring(c)
    val after = if (rest.isEmpty() || rest.startsWith(" ")) rest else " $rest"
    val inserted = when {
        text.endsWith("#") -> tag
        else -> {
            hashRegex.find(text)?.let { before = before.dropLast(it.value.length) }
            if (before.isNotEmpty() && !before.endsWith(" ")) " #$tag" else "#$tag"
        }
    }
    val head = before + inserted
    return if (after.isEmpty()) "$head " to head.length + 1 else head + after to head.length + 1
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddTodoScreen(mode: AddMode, todoId: String?, date: String?, text: String?) {
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val baseTodo = remember { todoId?.let { Db.todo(it) } }
    val breakdownTodo = if (mode == AddMode.breakdown) baseTodo else null
    val editedTodo = if (mode == AddMode.edit) baseTodo else null
    val initiallyCompleted = editedTodo?.completed == true
    val vms = remember { mutableStateListOf<TodoVM>() }
    var saving by remember { mutableStateOf(false) }
    var buttonShake by remember { mutableIntStateOf(0) }
    val listState = rememberLazyListState()
    val isEdit = editedTodo != null
    val isValid = vms.all { it.isValid }

    fun addTodo() {
        vms.forEach { it.collapsed = true }
        val vm = TodoVM()
        if (breakdownTodo != null) {
            if (vms.isEmpty() && breakdownTodo.repetitive) {
                vm.text = breakdownTodo.text
                vm.time = breakdownTodo.time
            } else if (Settings.duplicateTagInBreakdown == true) {
                vm.text = hashtags(breakdownTodo.text).joinToString(" ") { "#$it" }
            }
            vm.repetitive = breakdownTodo.repetitive
        }
        if (date != null) {
            vm.monthAndYear = date.take(7)
            vm.date = date.drop(8).take(2).ifEmpty { null }
        }
        vms.add(vm)
        scope.launch { listState.animateScrollToItem(vms.size) }
    }

    // componentDidMount
    remember {
        if (Onboarding.active && Onboarding.step == TutorialStep.Breakdown) {
            listOf("onboarding.breakdownTodo1", "onboarding.breakdownTodo2", "onboarding.breakdownTodo3").forEach {
                vms.add(TodoVM().apply { this.text = t(it); collapsed = true })
            }
        } else addTodo()
        if (editedTodo != null) vms[0].edit(editedTodo)
        if (text != null) vms[0].text = text
        true
    }
    LaunchedEffect(Unit) {
        if (Onboarding.step == TutorialStep.AddTask || Onboarding.step == TutorialStep.Breakdown) Onboarding.nextStep()
    }

    fun isDirty(): Boolean {
        for (vm in vms) {
            val e = vm.editedTodo
            if (e != null) {
                if (e.text != vm.text || e.completed != vm.completed || e.frog != vm.frog || e.monthAndYear != vm.monthAndYear ||
                    e.date != vm.date || e.time != vm.time || e.repetitive != vm.repetitive
                ) return true
            } else if (vm.text.isNotEmpty() || vm.addOnTop || vm.completed || vm.frog || vm.monthAndYear != null || vm.date != null ||
                vm.time != null || vm.repetitive
            ) {
                if (!(vm.text.isNotEmpty() || vm.completed || vm.frog || vm.time != null || vm.repetitive) &&
                    vm.monthAndYear != null && vm.date != null && isToday(vm.monthAndYear, vm.date)
                ) continue
                return true
            }
        }
        return false
    }

    suspend fun saveTodo() {
        if (saving) {
            Ui.toast("🤔")
            return
        }
        if (breakdownTodo != null && Onboarding.active && vms.size < 2) {
            focusManager.clearFocus()
            Onboarding.nextStep(TutorialStep.BreakdownLessThanTwo)
            return
        }
        saving = true
        val dayCompletedInitially = Todos.shouldShowDayCompletion()
        val titles = ArrayList<String>()
        val onTop = ArrayList<Todo>()
        val toBottom = ArrayList<Todo>()
        val completedAtCreation = ArrayList<String>()
        val toSave = ArrayList<Todo>()
        val currentMonth = LocalDate.now().monthAndYear()
        val me = Session.user?.id
        for ((i, vm) in vms.withIndex()) {
            val edited = vm.editedTodo
            if (edited == null) {
                val todo = Todo(
                    text = vm.text, completed = vm.completed, frog = vm.frog, order = i.toDouble(),
                    monthAndYear = vm.monthAndYear ?: currentMonth, date = vm.date, time = vm.time, repetitive = vm.repetitive,
                    encrypted = Session.encryptionKey != null && vm.delegate == null,
                )
                if (todo.completed) completedAtCreation.add(todo.text)
                val delegate = vm.delegate
                if (delegate?.id != null && me != null) {
                    todo.userId = delegate.id
                    todo.delegatorId = me
                }
                toSave.add(todo)
                titles.add(todo.title)
                if (vm.addOnTop) onTop.add(todo) else toBottom.add(todo)
            } else {
                val oldTitle = edited.title
                val newMonth = vm.monthAndYear ?: currentMonth
                if (edited.frogFails > 2 && (edited.monthAndYear != newMonth || edited.date != vm.date)) {
                    // The RN app left the screen stuck in "saving" here
                    saving = false
                    Todos.requestBreakdown(edited) { Nav.back() }
                    return
                }
                val failed = isTodoOld(edited.monthAndYear, edited.date) && (edited.date != vm.date || edited.monthAndYear != vm.monthAndYear) && !edited.completed
                if (vm.completed && !edited.completed) completedAtCreation.add(vm.text)
                // Fresh copy so fields synced while editing aren't overwritten
                val todo = Db.todo(edited.id) ?: edited
                todo.text = vm.text
                todo.completed = vm.completed
                todo.frog = vm.frog
                todo.monthAndYear = newMonth
                todo.date = vm.date
                todo.time = vm.time
                todo.repetitive = vm.repetitive
                if (failed && !todo.date.isNullOrEmpty()) {
                    todo.frogFails++
                    if (todo.frogFails > 1) todo.frog = true
                }
                todo.delegateAccepted = vm.delegateAccepted
                toSave.add(todo)
                titles.add(oldTitle)
                titles.add(todo.title)
            }
        }
        Db.saveTodos(toSave)
        completedAtCreation.forEach {
            Tags.incrementEpicPoints(it)
            Hero.points++
        }
        if (breakdownTodo != null) {
            val original = Db.todo(breakdownTodo.id) ?: breakdownTodo
            Todos.markCompleted(original)
            titles.add(original.title)
            Effects.confetti()
        }
        val hasCompleted = breakdownTodo != null || vms.any { it.editedTodo?.completed == true || it.completed }
        val hasFrog = breakdownTodo?.frog == true || vms.any { it.editedTodo?.frog == true || it.frog }
        if (hasCompleted && !initiallyCompleted) {
            if (hasFrog) Sounds.frogComplete() else Sounds.taskComplete()
        }
        Nav.back()
        Tags.addTags(vms.map { it.text })
        Todos.fixOrder(titles, onTop, toBottom, toSave)
        if (breakdownTodo != null && !dayCompletedInitially) Todos.checkDayCompletion()
        if (Onboarding.active) Onboarding.nextStep()
        focusManager.clearFocus()
    }

    fun trySave() {
        if (!isValid || saving) {
            vms.forEach { if (!it.isValid) { it.collapsed = false; it.shake++ } }
            buttonShake++
        } else scope.launch { saveTodo() }
    }

    fun onBackPress() {
        if (Onboarding.active) {
            val step = Onboarding.step
            Onboarding.nextStep(
                if (step == TutorialStep.BreakdownTodoAction || step == TutorialStep.BreakdownTodo) TutorialStep.BreakdownLessThanTwo else TutorialStep.Close
            )
            focusManager.clearFocus()
            return
        }
        // The RN app ignored the hardware back button here when nothing was entered
        if (!isDirty()) {
            Nav.back()
            return
        }
        val plural = vms.size > 1
        fun s(key: String) = t(if (plural) key else "${key}Singular")
        val title = s(if (isValid) "dirtyValidSave" else "dirtyInvalidSave")
        val buttons = ArrayList<Pair<String, () -> Unit>>()
        if (isValid) buttons.add(s("saveTasks") to { scope.launch { saveTodo() }; Unit })
        buttons.add(s("dissmissTasks") to { Nav.back(); Unit })
        buttons.add(s(if (isValid) "changeTasks" else "fixTasks") to {})
        Ui.dialogs.add(DialogSpec(title, null, buttons, destructive = setOf(if (isValid) 1 else 0), cancelable = true, sheet = true))
    }

    BackHandler { onBackPress() }
    DisposableEffect(Unit) {
        AddTodoActions.save = { trySave() }
        onDispose {
            AddTodoActions.save = {}
        }
    }

    // keyboardDidHide in TodoVM: finishing the text moves the tutorial on
    val imeVisible = WindowInsets.isImeVisible
    var imeWasVisible by remember { mutableStateOf(false) }
    LaunchedEffect(imeVisible) {
        if (imeWasVisible && !imeVisible && Onboarding.active && vms.firstOrNull()?.text?.isNotEmpty() == true &&
            (Onboarding.step == TutorialStep.AddText || Onboarding.step == TutorialStep.AddTextContinueButton)
        ) Onboarding.nextStep(TutorialStep.SelectDate)
        imeWasVisible = imeVisible
    }

    val title = when {
        isEdit -> t("editTodo")
        mode == AddMode.breakdown -> t("breakdownTodo")
        else -> t("addTodo")
    }
    StackScreen(
        title,
        // Only the add screen's header back asks about unsaved changes in RN; hardware back always does
        onBack = { if (mode == AddMode.add) onBackPress() else Nav.back() },
        actions = {
            if (!isEdit) {
                val enabled = mode == AddMode.breakdown || !Onboarding.active
                MIcon(
                    MaterialIcons.Filled.Add, Colors.text.copy(alpha = 0.5f),
                    modifier = Modifier.padding(horizontal = 12.dp).onboardingTarget(Target.ADD_BUTTON),
                    onClick = { if (enabled) addTodo() },
                )
            }
            InfoButton(if (isEdit) "infoEdit" else if (mode == AddMode.breakdown) "infoBreakdown" else "infoAdd")
        },
    ) {
        val reorderState = rememberReorderableLazyListState(listState) { from, to ->
            val fromI = vms.indexOfFirst { it.key == from.key }
            val toI = vms.indexOfFirst { it.key == to.key }
            // The RN app swapped the two forms instead of moving the dragged one
            if (fromI >= 0 && toI >= 0) vms.add(toI, vms.removeAt(fromI))
        }
        Column(Modifier.weight(1f).imePadding().navigationBarsPadding()) {
            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(vertical = 10.dp)) {
                item("breakdown") {
                    if (breakdownTodo != null) TodoCard(breakdownTodo, CardType.breakdown, Modifier.onboardingTarget(Target.BREAKDOWN_TODO))
                }
                vms.forEachIndexed { index, vm ->
                    item(vm.key) {
                        ReorderableItem(reorderState, vm.key) {
                            Column(Modifier.background(Colors.background)) {
                                val delete = if (vms.size > 1) ({ vms.remove(vm); if (vms.all { it.collapsed }) vms.last().collapsed = false }) else null
                                if (vm.collapsed) {
                                    CollapsedTodo(vm, delete, Modifier.longPressDraggableHandle())
                                } else {
                                    TodoForm(vm, delete, breakdownTodo != null && Settings.duplicateTagInBreakdown == true)
                                }
                                if (index != vms.size - 1) Divider()
                            }
                        }
                    }
                }
            }
            SaveRow(isEdit, plural = vms.size > 1, enabled = isValid && !saving, shake = buttonShake, onSave = { trySave() }, onAdd = { addTodo() }, editedTodo = editedTodo)
        }
    }
}

@Composable
private fun SaveRow(isEdit: Boolean, plural: Boolean, enabled: Boolean, shake: Int, onSave: () -> Unit, onAdd: () -> Unit, editedTodo: Todo?) {
    val step = Onboarding.step
    val saveAllowed = !Onboarding.active || step == TutorialStep.AddTodoComplete || step == TutorialStep.BreakdownTodoAction
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp).height(48.dp)) {
        @OptIn(ExperimentalFoundationApi::class)
        Box(
            Modifier.weight(1f).fillMaxHeight().shake(shake).onboardingTarget(Target.SAVE_BUTTON).clip(RoundedCornerShape(10.dp))
                .background(if (enabled) Colors.primary else Color.Gray)
                .combinedClickable(
                    enabled = saveAllowed,
                    onLongClick = {
                        Ui.copy(editedTodo?.let { TodoEntity.toJson(it).toString() } ?: "undefined", t("copied"))
                    },
                    onClick = onSave,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                t(if (isEdit) "saveTodo" else if (plural) "addTodoPlural" else "addTodoSingular"),
                color = Color.White, fontSize = 16.sp,
            )
        }
        if (!isEdit) {
            val addAllowed = !Onboarding.active || step == TutorialStep.BreakdownTodoAction
            Box(
                Modifier.padding(start = 10.dp).aspectRatio(1f).clip(RoundedCornerShape(10.dp)).background(brandGradient)
                    .clickable(enabled = addAllowed, onClick = onAdd),
                contentAlignment = Alignment.Center,
            ) { TIcon("add_outline_28", 20.dp, Color.White) }
        }
    }
}

/** Horizontal shake (react-native-animatable's shake) whenever [trigger] grows */
@Composable
private fun Modifier.shake(trigger: Int): Modifier {
    val offset = remember { Animatable(0f) }
    LaunchedEffect(trigger) {
        if (trigger == 0) return@LaunchedEffect
        repeat(6) { offset.animateTo(if (it % 2 == 0) 10f else -10f, tween(60)) }
        offset.animateTo(0f, tween(60))
    }
    return offset { IntOffset(offset.value.roundToInt(), 0) }
}

@Composable
private fun CollapseButton(vm: TodoVM) {
    MIcon(
        if (vm.collapsed) MaterialIcons.Filled.KeyboardArrowDown else MaterialIcons.Filled.KeyboardArrowUp,
        if (!vm.collapsed || vm.isValid) Colors.text else Color(0xFFFF6347), 25.dp,
        Modifier.padding(5.dp),
    ) { vm.collapsed = !vm.collapsed }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CollapsedTodo(vm: TodoVM, delete: (() -> Unit)?, dragModifier: Modifier) {
    Row(
        dragModifier.fillMaxWidth().clickable { vm.collapsed = false }.padding(vertical = verticalSpacing).padding(start = 12.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (delete != null) IconBtn("delete_outline_28-iOS", Colors.destruct, onClick = delete)
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            Text(
                (if (vm.frog) "🐸 " else "") + (vm.time?.let { "$it " } ?: "") + vm.text.ifEmpty { t("todo.create.placeholder") },
                color = Colors.text, fontFamily = Fonts.displayMedium, fontSize = FONT_SIZE.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            vm.monthAndYear?.let {
                Text("$it${if (!vm.date.isNullOrEmpty()) "-${vm.date}" else ""}", fontFamily = Fonts.textRegular, fontSize = 13.sp, color = Colors.placeholder)
            }
        }
        CollapseButton(vm)
    }
}

private val rowStyle @Composable get() = TextStyle(fontFamily = Fonts.textRegular, fontSize = FONT_SIZE.sp)

/** A tappable form row with a chevron (date, month, time, delegate, more, delete) */
@Composable
private fun FormRow(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClear: (() -> Unit)? = null,
    chevronColor: Color = Colors.border,
    onClick: () -> Unit,
) {
    Row(
        modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = verticalSpacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = rowStyle.copy(color = color), modifier = Modifier.weight(1f))
        if (onClear != null) MIcon(MaterialIcons.Filled.Close, Colors.border, 24.dp, onClick = onClear)
        TIcon("chevron_right_outline_28", 24.dp, chevronColor)
    }
}

@Composable
private fun SwitchRow(name: String, value: Boolean, modifier: Modifier = Modifier, onChange: (Boolean) -> Unit) {
    Row(modifier.fillMaxWidth().padding(vertical = verticalSpacing), verticalAlignment = Alignment.CenterVertically) {
        Text(name, style = rowStyle.copy(color = Colors.text), modifier = Modifier.weight(1f))
        TodorantSwitch(value, onChange)
    }
}

@Composable
private fun TodoForm(vm: TodoVM, delete: (() -> Unit)?, showCross: Boolean) {
    val context = LocalContext.current
    val tutorial = Onboarding.active
    val step = Onboarding.step
    val me = Session.user?.id
    val pickingAllowed = !tutorial || step == TutorialStep.BreakdownTodoAction || step == TutorialStep.SelectDate
    /** The tutorial explains dates first instead of opening a picker */
    fun dateBlocked() = (tutorial && step == TutorialStep.SelectDate).also { if (it) Onboarding.nextStep(TutorialStep.SelectDateNotAllowed) }
    val showMoreBlock = (Settings.showMoreByDefault == true && !tutorial) || vm.showMore
    Column(Modifier.padding(horizontal = 16.dp, vertical = verticalSpacing)) {
        TextRow(vm, showCross)
        TagsRow(vm)
        Column(Modifier.onboardingTarget(Target.DATE_ROW)) {
            FormRow(
                if (vm.datePickerValue != null && !vm.date.isNullOrEmpty()) vm.datePickerValue!! else t("addTodoDay"),
                if (vm.datePickerValue != null && !vm.date.isNullOrEmpty()) Colors.text else Colors.placeholder,
                Modifier.shake(if (vm.monthAndYear == null) vm.shake else 0), enabled = pickingAllowed,
            ) {
                if (dateBlocked()) return@FormRow
                vm.showDatePicker = !vm.showDatePicker
                if (vm.date.isNullOrEmpty()) {
                    vm.monthAndYear = null
                    vm.date = null
                }
                vm.showMonthAndYearPicker = false
            }
            if (vm.showDatePicker) {
                val selected = vm.datePickerValue?.takeIf { !vm.date.isNullOrEmpty() }?.let(LocalDate::parse)
                MonthCalendar(
                    YearMonth.from(selected ?: LocalDate.now()),
                    onDayClick = { vm.setDatePickerValue(it); vm.showDatePicker = false },
                    selected = selected,
                    minDate = if (BuildConfig.DEBUG) null else todayWithStartOfDay(),
                )
            }
            val monthSet = vm.monthAndYear != null && vm.date.isNullOrEmpty()
            FormRow(
                if (monthSet) vm.monthAndYear!! else t("addTodoMonth"),
                if (monthSet) Colors.text else Colors.placeholder,
                Modifier.shake(if (vm.monthAndYear == null) vm.shake else 0), enabled = pickingAllowed,
            ) {
                if (dateBlocked()) return@FormRow
                vm.showMonthAndYearPicker = !vm.showMonthAndYearPicker
                if (!vm.date.isNullOrEmpty()) {
                    vm.monthAndYear = null
                    vm.date = null
                }
                vm.showDatePicker = false
                if (vm.monthAndYear == null && vm.showMonthAndYearPicker) vm.monthAndYear = YearMonth.now().plusMonths(1).toString()
            }
        }
        if (vm.showMonthAndYearPicker) MonthYearPicker(vm.monthAndYear) { vm.monthAndYear = it; vm.date = null }
        if (showMoreBlock) {
            FormRow(
                vm.time ?: t("addTodoTime"), if (vm.time != null) Colors.text else Colors.placeholder,
                onClear = if (vm.time != null) ({ vm.time = null }) else null,
            ) {
                val initial = parseTime(vm.time) ?: LocalTime.now()
                // The RN app set the time to "now" even when the picker was cancelled
                TimePickerDialog(context, { _, h, m ->
                    vm.time = LocalTime.of(h, m).hhmm()
                    if (vm.monthAndYear == null) vm.setDatePickerValue(LocalDate.now())
                }, initial.hour, initial.minute, android.text.format.DateFormat.is24HourFormat(context)).show()
            }
            if (Session.user != null && vm.editedTodo == null) {
                val delegates = dbState(initial = emptyList<DelegationUser>()) { Db.delegates().filter { it.id != me && it.id != null } }
                if (delegates.isNotEmpty()) FormRow(
                    vm.delegate?.name ?: t("delegate.pickDelegateField"),
                    if (vm.delegate != null) Colors.text else Colors.placeholder,
                    onClear = if (vm.delegate != null) ({ vm.delegate = null }) else null,
                ) {
                    if (tutorial) return@FormRow
                    Ui.actionSheet(t("delegate.to"), delegates.map { it.name ?: "" }) { vm.delegate = delegates[it] }
                }
            }
        }
        SwitchRow(t("todo.create.frog"), vm.frog, Modifier.onboardingTarget(Target.FROG_ROW)) {
            vm.frog = it
            if (tutorial && step == TutorialStep.SelectFrog) Onboarding.nextStep()
        }
        val delegatedByMe = vm.editedTodo?.delegatorId != null && vm.editedTodo?.delegatorId == me
        if (!delegatedByMe) {
            val completedAllowed = !tutorial || step == TutorialStep.BreakdownTodoAction || step == TutorialStep.SelectCompleted
            SwitchRow(t("completed"), vm.completed, Modifier.onboardingTarget(Target.COMPLETED_ROW)) { value ->
                if (!completedAllowed) return@SwitchRow
                if (tutorial) {
                    Onboarding.nextStep(TutorialStep.BreakdownCompletedTodo)
                    vm.completed = false
                    return@SwitchRow
                }
                vm.completed = value
                if (Session.user != null && vm.editedTodo?.delegatorId != me && vm.editedTodo?.delegateAccepted != true) {
                    vm.delegateAccepted = value
                }
            }
        }
        if (Settings.showMoreByDefault == true || vm.showMore) {
            SwitchRow(t("breakdownMessage.title"), vm.repetitive) { vm.repetitive = it }
        }
        if (showMoreBlock && vm.editedTodo == null) {
            SwitchRow(t("addTodoOnTop"), vm.addOnTop) { vm.addOnTop = it }
        }
        if ((Settings.showMoreByDefault != true || tutorial) && !vm.showMore) {
            FormRow(
                t("addTodoMore"), Colors.primary,
                Modifier.onboardingTarget(Target.SHOW_MORE_ROW).ifTrue(Settings.isDark) { alpha(0.8f) },
                enabled = !tutorial || step == TutorialStep.ShowMore || step == TutorialStep.BreakdownTodoAction,
                chevronColor = Colors.primary,
            ) {
                vm.showMore = true
                if (tutorial && step == TutorialStep.ShowMore) Onboarding.nextStep()
            }
        }
        if (delete != null) {
            FormRow(t("delete"), Colors.primary, Modifier.ifTrue(Settings.isDark) { alpha(0.8f) }, chevronColor = Colors.primary, onClick = delete)
        }
    }
}

@Composable
private fun TextRow(vm: TodoVM, showCross: Boolean) {
    val tutorial = Onboarding.active
    val locked = vm.editedTodo?.encrypted == true && Session.encryptionKey == null
    LaunchedEffect(Unit) { if (!tutorial && !locked) runCatching { vm.focus.requestFocus() } }
    Row(
        Modifier.fillMaxWidth().shake(if (vm.text.isEmpty()) vm.shake else 0).onboardingTarget(Target.TEXT_ROW).padding(vertical = verticalSpacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.weight(1f)) {
            BasicTextField(
                vm.value,
                onValueChange = {
                    // maxLength={1500}: cut, don't reject (a long paste still goes in)
                    vm.value = if (it.text.length <= 1500) it else it.copy(
                        text = it.text.take(1500),
                        selection = androidx.compose.ui.text.TextRange(minOf(it.selection.start, 1500), minOf(it.selection.end, 1500)),
                    )
                    if (tutorial) Onboarding.textInTodo = it.text
                },
                enabled = !locked,
                singleLine = tutorial,
                textStyle = rowStyle.copy(color = Colors.text),
                cursorBrush = SolidColor(Colors.primary),
                keyboardOptions = KeyboardOptions(imeAction = if (tutorial) ImeAction.Done else ImeAction.Default),
                keyboardActions = KeyboardActions(onDone = {
                    if (tutorial && vm.text.isNotEmpty() &&
                        (Onboarding.step == TutorialStep.AddText || Onboarding.step == TutorialStep.AddTextContinueButton)
                    ) Onboarding.nextStep(TutorialStep.SelectDate)
                }),
                modifier = Modifier.fillMaxWidth().focusRequester(vm.focus),
            )
            if (vm.text.isEmpty()) Text(t("todo.create.text"), style = rowStyle.copy(color = Colors.placeholder))
        }
        if (vm.text.isNotEmpty() && showCross) MIcon(MaterialIcons.Filled.Close, Colors.text, 25.dp, Modifier.padding(5.dp)) { vm.text = "" }
        if (!locked && vm.text.isEmpty()) MIcon(MaterialIcons.Filled.ContentPaste, Colors.text, 25.dp, Modifier.padding(5.dp)) {
            vm.text += Ui.paste()
        }
        CollapseButton(vm)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagsRow(vm: TodoVM) {
    val tags = dbState(vm.text, vm.showMore, initial = emptyList<com.todorant.data.Tag>()) { Tags.suggestions(vm.text, vm.showMore) }
    if (tags.isEmpty()) return
    FlowRow(Modifier.fillMaxWidth().padding(bottom = verticalSpacing / 2)) {
        for (tag in tags) {
            Text(
                "#${tag.tag}", color = tag.color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.link,
                modifier = Modifier.clickable { vm.applyTag(tag.tag); runCatching { vm.focus.requestFocus() } }.padding(horizontal = 4.dp, vertical = 2.dp),
            )
        }
    }
}

/** react-native-month-picker: months from next month up to 100 years ahead */
@Composable
private fun MonthYearPicker(selected: String?, onPick: (String) -> Unit) {
    val min = YearMonth.now().plusMonths(1)
    val max = YearMonth.now().plusYears(100)
    val selectedMonth = selected?.let { runCatching { YearMonth.parse(it) }.getOrNull() }
    var year by remember { mutableIntStateOf((selectedMonth ?: min).year) }
    val locale = I18n.locale()
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            MIcon(MaterialIcons.AutoMirrored.Filled.KeyboardArrowLeft, Colors.text, 28.dp) { if (year > min.year) year-- }
            Text("$year", style = rowStyle.copy(color = Colors.text), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            MIcon(MaterialIcons.AutoMirrored.Filled.KeyboardArrowRight, Colors.text, 28.dp) { if (year < max.year) year++ }
        }
        for (row in 0 until 3) {
            Row(Modifier.fillMaxWidth()) {
                for (col in 0 until 4) {
                    val ym = YearMonth.of(year, row * 4 + col + 1)
                    val enabled = ym >= min && ym <= max
                    val isSelected = ym == selectedMonth
                    Box(
                        Modifier.weight(1f).padding(4.dp).clip(RoundedCornerShape(8.dp))
                            .background(if (isSelected) Colors.primary else Color.Transparent)
                            .clickable(enabled = enabled) { onPick(ym.toString()) }.padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            capitalizeSentence(ym.month.getDisplayName(DateTextStyle.SHORT_STANDALONE, locale)),
                            color = when { isSelected -> Colors.invertedText; enabled -> Colors.text; else -> Colors.placeholder },
                        )
                    }
                }
            }
        }
    }
}
