package com.todorant.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import com.todorant.data.Pref
import com.todorant.data.boolPref

/** Same order as the RN TutorialStep enum: nextStep() without an argument goes to the following one */
enum class TutorialStep {
    SelectDateNotAllowed, BreakdownCompletedTodo, BreakdownLessThanTwo, AddTextContinueTooFast, AddTextContinueButton,
    Finished, Close, Start, Explain, AddTask, AddText, SelectDate, SelectFrog, SelectCompleted, ShowMore, AddAnotherTask,
    AddTodoComplete, ExplainCurrent, DeleteEditComplete, Breakdown, BreakdownTodo, BreakdownTodoAction, BreakdownVanish,
    PlanningExplain, PlanningExplain2, ExplainHashtags, ExplainSearchAndCompleted, ExplainReccuring, ExplainSettings,
    ExplainNotifications, ExplainNotificationsGoogle, ExplainMultiplatform, ExplainPricing, Feedback, Rules, Info, Congratulations,
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

/** OnboardingStore: the interactive tutorial shown until [tutorialIsShown] */
object Onboarding {
    var tutorialIsShown by boolPref("tutorialIsShown", false)
    var savedStep by Pref<TutorialStep?>("onboarding.savedStep", null) { runCatching { TutorialStep.valueOf(it) }.getOrNull() }
    var screen by Pref("onboarding.screen", Route.CURRENT) { it }

    var step by mutableStateOf(TutorialStep.Start)
    var previousStep by mutableStateOf(TutorialStep.Start)
    var textInTodo by mutableStateOf<String?>(null)

    /** Tutorial is running, most of the UI is locked */
    val active get() = !tutorialIsShown

    /** Element bounds in the root, keyed by [Target] ids */
    val targets = mutableStateMapOf<String, Rect>()

    /** Called with a step to jump there, or without to go to the following step */
    var nextStepHandler: (TutorialStep?) -> Unit = {}
    fun nextStep(step: TutorialStep? = null) = nextStepHandler(step)
}

fun Modifier.onboardingTarget(id: String) = onGloballyPositioned { Onboarding.targets[id] = it.boundsInRoot() }
