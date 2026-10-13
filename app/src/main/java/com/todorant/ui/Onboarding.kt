package com.todorant.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import com.todorant.App
import com.todorant.data.Pref
import com.todorant.data.boolPref
import com.todorant.logic.Todos
import com.todorant.logic.todayTitle
import com.todorant.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Same order as the RN TutorialStep enum: nextStep() without an argument goes to the following one */
enum class TutorialStep {
    SelectDateNotAllowed, BreakdownCompletedTodo, BreakdownLessThanTwo, AddTextContinueTooFast, AddTextContinueButton,
    Finished, Close, Start, Explain, AddTask, AddText, SelectDate, SelectFrog, SelectCompleted, ShowMore, AddAnotherTask,
    AddTodoComplete, ExplainCurrent, DeleteEditComplete, Breakdown, BreakdownTodo, BreakdownTodoAction, BreakdownVanish,
    PlanningExplain, PlanningExplain2, ExplainHashtags, ExplainSearchAndCompleted, ExplainReccuring, ExplainSettings,
    ExplainNotifications, ExplainNotificationsGoogle, ExplainMultiplatform, ExplainPricing, Feedback, Rules, Info, Congratulations;

    /** Translation key: the RN enum value differs from its name for one step */
    val key get() = if (this == BreakdownCompletedTodo) "BreakDownCompletedTodo" else name
}

/** Ids of UI elements the tutorial highlights; screens tag them with [onboardingTarget] */
object Target {
    const val PLUS_BUTTON = "plusButton"
    const val TEXT_ROW = "textRow"
    const val DATE_ROW = "dateRow"
    const val FROG_ROW = "frogRow"
    const val COMPLETED_ROW = "completedRow"
    const val SHOW_MORE_ROW = "showMoreRow"
    const val ADD_BUTTON = "addButton"
    const val SAVE_BUTTON = "saveButton"
    const val CURRENT_TODO = "currentTodo"
    const val TODO_ACTIONS = "todoActions"
    const val BREAKDOWN_BUTTON = "breakdownButton"
    const val BREAKDOWN_TODO = "breakdownTodo"
    const val TAB_PLANNING = "tabPlanning"
    const val TAB_SETTINGS = "tabSettings"
    const val PLANNING_SEGMENT = "planningSegment"
    const val INTEGRATIONS_BUTTON = "integrationsButton"
    const val SUPPORT_BUTTON = "supportButton"
    const val HOW_TO_USE = "howToUse"
    const val INFO_BUTTON = "infoButton"
}

/** A message box button; [message] is a key under onboarding.<step>, [notAllowed] shows "Got it!" */
class OnboardingButton(val message: String? = null, val preferred: Boolean = false, val notAllowed: Boolean = false, val action: () -> Unit)

/** Step object from the RN AllStages. Hole sizing follows buildRnHole. */
data class Step(
    val target: String? = null,
    val buttons: List<OnboardingButton> = emptyList(),
    val center: Boolean = false,
    val notShowContinue: Boolean = false,
    val notShowClose: Boolean = false,
    val notShowMessage: Boolean = false,
    val dontSave: Boolean = false,
    val customContinueText: Boolean = false,
    val divider: Float = 2f,
    /** dp; RN used 128 on Android, which is a pill */
    val borderRadius: Float = 128f,
    val heightMultiplier: Float = 1f,
    /** Screen to switch to (changeSavedSreen) */
    val screen: String? = null,
    /** Settings list has to scroll to the target first */
    val scroll: Boolean = false,
)

/** OnboardingStore: the interactive tutorial shown until [tutorialIsShown] */
object Onboarding {
    var tutorialIsShown by boolPref("tutorialIsShown", false)
    var savedStep by Pref<TutorialStep?>("onboarding.savedStep", null) { runCatching { TutorialStep.valueOf(it) }.getOrNull() }
    var screen by Pref("onboarding.screen", Route.CURRENT) { it }

    var step by mutableStateOf(TutorialStep.Start)
    var previousStep by mutableStateOf(TutorialStep.Start)
    var stepObject by mutableStateOf(stage(TutorialStep.Start)!!.copy(screen = null))
    var textInTodo by mutableStateOf<String?>(null)

    /** Tutorial is running, most of the UI is locked */
    val active get() = !tutorialIsShown

    /** Element bounds in the root, keyed by [Target] ids */
    val targets = mutableStateMapOf<String, Rect>()

    /** Saves the todos on the add screen (AddTodoComplete / BreakdownTodoAction "got it") — set by the add screen */
    var saveTodo: () -> Unit = {}
    /** Scrolls the settings list so the [Target] id is visible — set by the settings screen */
    var scrollToTarget: (String) -> Unit = {}

    var nextStepHandler: (TutorialStep?) -> Unit = ::goTo
    /** Called with a step to jump there, or without to go to the following step */
    fun nextStep(step: TutorialStep? = null) = nextStepHandler(step)

    private fun goTo(next: TutorialStep?) {
        val target = next ?: TutorialStep.entries.getOrNull(step.ordinal + 1) ?: return
        if (step != TutorialStep.Close && step != TutorialStep.BreakdownLessThanTwo && step != TutorialStep.BreakdownCompletedTodo) {
            previousStep = step
        }
        val staged = stage(target)
        if (staged != null && !staged.dontSave) savedStep = target
        val obj = staged ?: Step()
        obj.screen?.let(::changeScreen)
        if (obj.scroll) obj.target?.let { scrollToTarget(it) }
        step = target
        stepObject = obj
    }

    /** changeSavedSreen: switches to a tab or the add screen and remembers it for restoring */
    private fun changeScreen(route: String) {
        screen = route
        if (route == Route.ADD) {
            if (Nav.currentRoute() != Route.ADD) Nav.go(Route.add())
        } else Nav.go(route)
    }

    private fun finish() {
        tutorialIsShown = true
        nextStep(TutorialStep.Start)
    }

    /** AllStages from the RN OnboardingStore */
    private fun stage(s: TutorialStep): Step? = when (s) {
        TutorialStep.Start -> Step(
            screen = Route.CURRENT, center = true, notShowClose = true, customContinueText = true,
            buttons = listOf(OnboardingButton("closeButtonText") { nextStep(TutorialStep.Close) }),
        )
        TutorialStep.Close -> Step(
            buttons = listOf(
                OnboardingButton("changedMyMind", preferred = true) { nextStep(previousStep) },
                OnboardingButton("article", preferred = true) { finish(); Nav.go(Route.RULES) },
                OnboardingButton("closeEverything") { finish(); Ui.toast(t("onboarding.Close.toast")) },
            ),
            notShowContinue = true, notShowClose = true, center = true, dontSave = true,
        )
        TutorialStep.Explain -> Step(center = true)
        TutorialStep.AddTask -> Step(target = Target.PLUS_BUTTON, notShowContinue = true)
        TutorialStep.AddText -> Step(screen = Route.ADD, target = Target.TEXT_ROW, divider = 16f, borderRadius = 16f)
        TutorialStep.SelectDate -> Step(target = Target.DATE_ROW, divider = 16f, dontSave = true, borderRadius = 16f)
        TutorialStep.SelectFrog -> Step(target = Target.FROG_ROW, divider = 16f, dontSave = true, customContinueText = true)
        TutorialStep.SelectCompleted -> Step(target = Target.COMPLETED_ROW, divider = 16f, dontSave = true)
        TutorialStep.ShowMore -> Step(target = Target.SHOW_MORE_ROW, divider = 16f, dontSave = true)
        TutorialStep.AddAnotherTask -> Step(target = Target.ADD_BUTTON, dontSave = true)
        TutorialStep.AddTodoComplete -> Step(
            target = Target.SAVE_BUTTON, notShowContinue = true, divider = 16f, dontSave = true, borderRadius = 10f, heightMultiplier = 6f,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) { saveTodo() }),
        )
        TutorialStep.ExplainCurrent -> Step(screen = Route.CURRENT, target = Target.CURRENT_TODO, divider = 11.5f)
        TutorialStep.DeleteEditComplete -> Step(target = Target.TODO_ACTIONS, divider = 4f)
        TutorialStep.Breakdown -> Step(
            target = Target.BREAKDOWN_BUTTON, notShowContinue = true, divider = 8f, heightMultiplier = 6f,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) {
                App.scope.launch {
                    val todo = io { Todos.forDay(todayTitle(), false).firstOrNull() }
                    todo?.let { Nav.go(Route.breakdown(it.id)) }
                }
            }),
        )
        TutorialStep.BreakdownTodo -> Step(target = Target.BREAKDOWN_TODO, divider = 16f, dontSave = true)
        TutorialStep.BreakdownTodoAction -> Step(
            target = Target.SAVE_BUTTON, dontSave = true, notShowContinue = true, divider = 16f, borderRadius = 10f, heightMultiplier = 6f,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) { saveTodo() }),
        )
        TutorialStep.BreakdownLessThanTwo -> Step(
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) { nextStep(previousStep) }),
            notShowContinue = true, notShowClose = true, center = true, dontSave = true, customContinueText = true,
        )
        TutorialStep.BreakdownVanish -> Step(center = true)
        TutorialStep.PlanningExplain -> Step(screen = Route.PLANNING, center = true, target = Target.TAB_PLANNING, divider = 0.5f)
        TutorialStep.PlanningExplain2 -> Step(center = true)
        TutorialStep.ExplainHashtags -> Step(center = true)
        TutorialStep.ExplainSearchAndCompleted -> Step(target = Target.PLANNING_SEGMENT, center = true)
        TutorialStep.ExplainReccuring -> Step(
            screen = Route.SETTINGS, center = true,
            buttons = listOf(OnboardingButton("article", preferred = true) { Ui.openUrl("https://blog.borodutch.com/automation-kills-productivity") }),
        )
        TutorialStep.ExplainSettings -> Step(center = true, target = Target.TAB_SETTINGS, divider = 0.5f)
        TutorialStep.ExplainNotifications -> Step(center = true)
        TutorialStep.ExplainNotificationsGoogle -> Step(target = Target.INTEGRATIONS_BUTTON, scroll = true)
        TutorialStep.ExplainMultiplatform -> Step(
            center = true, buttons = listOf(OnboardingButton("website", preferred = true) { Ui.openUrl("https://todorant.com") }),
        )
        TutorialStep.ExplainPricing -> Step(center = true)
        TutorialStep.Feedback -> Step(target = Target.SUPPORT_BUTTON, scroll = true)
        TutorialStep.Rules -> Step(target = Target.HOW_TO_USE, scroll = true)
        TutorialStep.Info -> Step(target = Target.INFO_BUTTON, center = true, scroll = true)
        TutorialStep.Congratulations -> Step(
            center = true, notShowContinue = true, notShowClose = true, customContinueText = true,
            buttons = listOf(OnboardingButton("nextStepButton", preferred = true) {
                finish()
                Effects.confetti(true)
            }),
        )
        TutorialStep.BreakdownCompletedTodo -> Step(
            center = true, notShowClose = true, notShowContinue = true, dontSave = true,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) {
                nextStep(if (previousStep == TutorialStep.SelectCompleted) TutorialStep.ShowMore else previousStep)
            }),
        )
        TutorialStep.SelectDateNotAllowed -> Step(
            center = true, notShowClose = true, notShowContinue = true, dontSave = true,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) { nextStep(TutorialStep.SelectFrog) }),
        )
        TutorialStep.AddTextContinueButton -> Step(
            target = Target.TEXT_ROW, divider = 16f, borderRadius = 16f, dontSave = true, notShowMessage = true, notShowContinue = true,
            buttons = listOf(OnboardingButton("continue", preferred = true) {
                nextStep(if (textInTodo.isNullOrEmpty()) TutorialStep.AddTextContinueTooFast else TutorialStep.SelectDate)
            }),
        )
        TutorialStep.AddTextContinueTooFast -> Step(
            center = true, notShowClose = true, notShowContinue = true, dontSave = true,
            buttons = listOf(OnboardingButton(preferred = true, notAllowed = true) { nextStep(TutorialStep.AddTextContinueButton) }),
        )
        TutorialStep.Finished -> null
    }

    /** checkOnboardingStep: resumes an unfinished tutorial on launch */
    fun restore() = App.scope.launch(Dispatchers.Main) {
        delay(500)
        val saved = savedStep
        if (tutorialIsShown || saved == null) return@launch
        changeScreen(screen)
        nextStep(saved)
    }
}

fun Modifier.onboardingTarget(id: String) = onGloballyPositioned { Onboarding.targets[id] = it.boundsInRoot() }
