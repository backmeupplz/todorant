package com.todorant

import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.todorant.data.AppState
import com.todorant.data.Db
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.Todo
import com.todorant.logic.Tags
import com.todorant.logic.Todos
import com.todorant.logic.monthAndYear
import com.todorant.logic.day
import com.todorant.sync.Sync
import com.todorant.sync.Rest
import com.todorant.logic.Account
import com.todorant.ui.Colors
import com.todorant.ui.DialogHost
import com.todorant.ui.EffectsLayer
import com.todorant.ui.Fonts
import com.todorant.ui.LocalTagColors
import com.todorant.ui.Nav
import com.todorant.ui.Onboarding
import com.todorant.ui.OnboardingOverlay
import com.todorant.ui.RatingPrompt
import com.todorant.ui.Route
import com.todorant.ui.Target
import com.todorant.ui.TodorantTheme
import com.todorant.ui.Ui
import com.todorant.ui.dbState
import com.todorant.ui.onboardingTarget
import com.todorant.ui.screens.AddEpicScreen
import com.todorant.ui.screens.AddMode
import com.todorant.ui.screens.AddTodoScreen
import com.todorant.ui.screens.ChangeTextScreen
import com.todorant.ui.screens.CurrentScreen
import com.todorant.ui.screens.DataScreen
import com.todorant.ui.screens.DelegationScreen
import com.todorant.ui.screens.DelegationUsersScreen
import com.todorant.ui.screens.HeroScreen
import com.todorant.ui.screens.LoginScreen
import com.todorant.ui.screens.PlanningScreen
import com.todorant.ui.screens.RulesScreen
import com.todorant.ui.screens.SecurityScreen
import com.todorant.ui.screens.SettingsScreen
import com.todorant.ui.screens.SocketsScreen
import com.todorant.ui.screens.TagsScreen
import com.todorant.ui.screens.TelegramLoginScreen
import com.todorant.ui.screens.WebPageScreen
import com.todorant.ui.screens.rememberTodayTitle
import java.time.LocalDate

class MainActivity : ComponentActivity() {
    private var pendingIntent by mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Recreated activities and launches from Recents carry the old intent; handling it again would e.g. add a todo twice
        if (savedInstanceState == null && intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0) pendingIntent = intent
        setContent {
            Settings.systemDark = isSystemInDarkTheme()
            LaunchedEffect(Settings.isDark) {
                val style = if (Settings.isDark) SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                enableEdgeToEdge(style, style)
            }
            TodorantTheme { Root(pendingIntent) { pendingIntent = null } }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingIntent = intent
    }

    override fun onResume() {
        super.onResume()
        // AppState change → globalSync in the RN app
        Sync.reconnect()
        Sync.request()
        RatingPrompt.appOpened()
    }
}

private val tabIcons = mapOf(
    Route.CURRENT to (R.drawable.tab_current to R.drawable.tab_current_active),
    Route.PLANNING to (R.drawable.tab_planning to R.drawable.tab_planning_active),
    Route.DELEGATION to (R.drawable.tab_delegation to R.drawable.tab_delegation_active),
    Route.SETTINGS to (R.drawable.tab_settings to R.drawable.tab_settings_active),
)

@Composable
private fun Root(intent: Intent?, onIntentHandled: () -> Unit) {
    val nav = rememberNavController()
    Nav.controller = nav
    val tagColors = dbState(initial = emptyMap()) { Tags.colorMap() }
    val today = rememberTodayTitle()
    val userId = Session.user?.id
    val planningRequired = dbState(userId, today, initial = false) { Todos.oldCount() > 0 } && !Onboarding.active
    val delegatedToMe = dbState(userId, initial = 0) { Todos.delegated(byMe = false).size }
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val onlySettings = Session.loggingOut || Session.isInitialSync
    val tabs = when {
        onlySettings -> listOf(Route.SETTINGS)
        planningRequired -> Route.tabs - Route.CURRENT
        else -> Route.tabs
    }
    LaunchedEffect(route, tabs) {
        // Checked when it runs: a link opened at launch may already have pushed a screen above the hidden tab
        if (route in Route.tabs && route !in tabs) Nav.go(tabs.first()) { Nav.currentRoute() == route }
    }
    LaunchedEffect(intent, route) {
        if (intent != null && route != null) {
            onIntentHandled()
            handleIntent(intent)
        }
    }
    CompositionLocalProvider(LocalTagColors provides tagColors) {
        Box(Modifier.fillMaxSize().background(Colors.background)) {
            Column(Modifier.fillMaxSize()) {
                NavHost(nav, Route.CURRENT, Modifier.weight(1f)) {
                    composable(Route.CURRENT) { CurrentScreen() }
                    composable(Route.PLANNING) { PlanningScreen() }
                    composable(Route.DELEGATION) { DelegationScreen() }
                    composable(Route.SETTINGS) { SettingsScreen() }
                    composable(
                        Route.ADD,
                        listOf(navArgument("date") { nullable = true; type = NavType.StringType }, navArgument("text") { nullable = true; type = NavType.StringType })
                    ) {
                        AddTodoScreen(AddMode.add, null, it.arguments?.getString("date")?.ifEmpty { null }, it.arguments?.getString("text")?.ifEmpty { null })
                    }
                    composable(Route.EDIT) { AddTodoScreen(AddMode.edit, it.arguments?.getString("id"), null, null) }
                    composable(Route.BREAKDOWN) { AddTodoScreen(AddMode.breakdown, it.arguments?.getString("id"), null, null) }
                    composable(Route.LOGIN, listOf(navArgument("wall") { type = NavType.BoolType; defaultValue = false })) {
                        LoginScreen(it.arguments?.getBoolean("wall") == true)
                    }
                    composable(Route.TERMS) { WebPageScreen(t("termsOfUse"), "https://todorant.com/terms") }
                    composable(Route.PRIVACY) { WebPageScreen(t("privacyPolicy"), "https://todorant.com/privacy") }
                    composable(Route.TELEGRAM) { TelegramLoginScreen() }
                    composable(Route.HERO) { HeroScreen() }
                    composable(Route.RULES) { RulesScreen() }
                    composable(Route.SOCKETS) { SocketsScreen() }
                    composable(Route.DATA) { DataScreen() }
                    composable(Route.TAGS) { TagsScreen() }
                    composable(Route.ADD_EPIC) { AddEpicScreen(it.arguments?.getString("id")!!) }
                    composable(Route.CHANGE_TEXT) { ChangeTextScreen(it.arguments?.getString("id")!!) }
                    composable(Route.SECURITY) { SecurityScreen() }
                    composable(Route.DELEGATORS) { DelegationUsersScreen(delegators = true) }
                    composable(Route.DELEGATES) { DelegationUsersScreen(delegators = false) }
                }
                if (route in Route.tabs) BottomBar(tabs, route, delegatedToMe > 0)
            }
            EffectsLayer()
            OnboardingOverlay()
            DialogHost()
        }
    }
}

@Composable
private fun BottomBar(tabs: List<String>, route: String?, delegatedToMe: Boolean) {
    HorizontalDivider(thickness = 0.5.dp, color = Colors.border)
    Row(Modifier.fillMaxWidth().background(Colors.background).windowInsetsPadding(WindowInsets.navigationBars)) {
        for (tab in tabs) {
            val focused = tab == route
            val title = when (tab) {
                Route.CURRENT -> t("current"); Route.PLANNING -> t("planning"); Route.DELEGATION -> t("delegate.title"); else -> t("settings")
            }
            val angle = if (tab == Route.SETTINGS && Sync.isSyncing) {
                rememberInfiniteTransition("sync").animateFloat(0f, 360f, infiniteRepeatable(tween(3000, easing = LinearEasing), RepeatMode.Restart), "spin").value
            } else 0f
            Column(
                Modifier.weight(1f).clickable(enabled = !Onboarding.active) { Nav.go(tab) }.padding(top = 6.dp, bottom = 4.dp)
                    .let { m -> when (tab) { Route.PLANNING -> m.onboardingTarget(Target.TAB_PLANNING); Route.SETTINGS -> m.onboardingTarget(Target.TAB_SETTINGS); else -> m } },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box {
                    val (icon, active) = tabIcons.getValue(tab)
                    Icon(painterResource(if (focused) active else icon), title, Modifier.size(28.dp).rotate(angle), tint = Color.Unspecified)
                    val badge = (tab == Route.SETTINGS && Session.user == null) || (tab == Route.DELEGATION && delegatedToMe)
                    if (badge) Box(Modifier.align(Alignment.TopEnd).offset(x = 5.dp).size(6.dp).background(Color.Red, CircleShape))
                }
                Text(title, fontSize = 10.sp, fontFamily = Fonts.textRegular, color = if (focused) Colors.primary else Color.Gray, maxLines = 1)
            }
        }
    }
}

/** Sharing, todorant:// links, invite links and the widget's "add" button */
private fun handleIntent(intent: Intent) {
    when {
        intent.action == Intent.ACTION_SEND -> {
            val text = listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT)).joinToString(", ")
            if (text.isNotEmpty()) Nav.go(Route.add(text = text))
        }
        intent.getBooleanExtra("widget", false) -> Nav.go(Route.add())
        // QA: adb shell am start -n com.todorant.debug/com.todorant.MainActivity --es route tags
        BuildConfig.DEBUG && intent.getStringExtra("route") != null -> Nav.go(intent.getStringExtra("route")!!)
        // QA: --es login <token> logs in without typing it
        BuildConfig.DEBUG && intent.getStringExtra("login") != null -> Ui.launch {
            runCatching { Account.login(Rest.loginToken(intent.getStringExtra("login")!!)) }.onFailure(Ui::error)
        }
        // QA: --es reminder 09:30 schedules it and posts the notification right away
        BuildConfig.DEBUG && intent.getStringExtra("reminder") != null -> {
            Settings.planningReminderTime = intent.getStringExtra("reminder")
            Reminders.restore()
            Reminders.notify(App.context)
        }
        intent.action == Intent.ACTION_VIEW -> intent.data?.let(::handleUrl)
    }
}

private fun handleUrl(uri: Uri) {
    val url = uri.toString()
    when {
        uri.scheme == "todorant" && uri.host == "create-todo" -> {
            val text = uri.getQueryParameter("articleBody")
            if (text.isNullOrEmpty()) Nav.go(Route.add()) else addTodoFromLink(text)
        }
        uri.scheme == "todorant" && uri.host == "search" -> uri.getQueryParameter("query")?.let { query ->
            Nav.go(Route.PLANNING)
            AppState.searchEnabled = true
            AppState.searchQuery = query
        }
        Regex("https://todorant.com/invite/.+").matches(url) -> Ui.confirm(t("delegate.inviteConfirm"), t("ok")) {
            val token = uri.pathSegments.getOrNull(1) ?: return@confirm
            if (Session.user?.token == null) {
                Ui.error(t("pleaseLogin"))
                return@confirm
            }
            Sync.acceptInvite(token)
        }
    }
}

/** todorant://create-todo?articleBody= (Google Assistant): adds right away when new todos default to today */
private fun addTodoFromLink(text: String) {
    if (Settings.showTodayOnAddTodo != true) {
        Nav.go(Route.add(text = text))
        return
    }
    val today = LocalDate.now()
    val todo = Todo(text = text, monthAndYear = today.monthAndYear(), date = today.day(), encrypted = Session.encryptionKey != null)
    Db.saveTodos(listOf(todo))
    Ui.launch {
        val newFirst = Settings.newTodosGoFirst == true
        Todos.fixOrder(listOf(todo.title), if (newFirst) listOf(todo) else emptyList(), if (newFirst) emptyList() else listOf(todo))
        Ui.toast("${t("addedTask")}: $text")
    }
}
