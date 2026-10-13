package com.todorant.ui.screens

import android.Manifest
import android.app.TimePickerDialog
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.todorant.BuildConfig
import com.todorant.I18n
import com.todorant.Reminders
import com.todorant.data.ColorMode
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.logic.Account
import com.todorant.logic.hhmm
import com.todorant.logic.parseTime
import com.todorant.sync.Rest
import com.todorant.sync.Sync
import com.todorant.t
import com.todorant.widget.Widget
import com.todorant.ui.CheckOrCross
import com.todorant.ui.Colors
import com.todorant.ui.Divider
import com.todorant.ui.LargeTitleScreen
import com.todorant.ui.MIcon
import com.todorant.ui.Nav
import com.todorant.ui.Onboarding
import com.todorant.ui.PrimaryButton
import com.todorant.ui.Route
import com.todorant.ui.SectionHeader
import com.todorant.ui.Spinner
import com.todorant.ui.TableItem
import com.todorant.ui.TableText
import com.todorant.ui.Target
import com.todorant.ui.TextAndSwitch
import com.todorant.ui.TutorialStep
import com.todorant.ui.Ui
import com.todorant.ui.onboardingTarget
import java.time.LocalTime

/** The settings list, so the tutorial can scroll to its targets */
object SettingsList {
    val state = LazyListState()
    private val indices = HashMap<String, Int>()

    internal fun register(target: String, index: Int) { indices[target] = index }

    /** Scrolls the item holding [target] (a [Target] id) to the top */
    suspend fun scrollTo(target: String) { indices[target]?.let { state.scrollToItem(it) } }
}

@Composable
fun SettingsScreen() {
    LaunchedEffect(Unit) {
        if (Sync.authorized) runCatching { Sync.sync(Sync.Kind.All) }.onFailure { Ui.error(it.message ?: "$it") }
    }
    val user = Session.user
    // ponytail: the title is tagged instead of the info button, LargeTitleScreen has no info modifier
    LargeTitleScreen(t("settings"), "infoSettings", state = SettingsList.state, infoModifier = Modifier.onboardingTarget(Target.INFO_BUTTON)) {
        // The large title takes item 0
        var index = 1
        fun row(target: String? = null, content: @Composable () -> Unit) {
            target?.let { SettingsList.register(it, index) }
            index++
            item(target) { content() }
        }
        // Important
        row { Divider(); SectionHeader(t("important")) }
        row(Target.HOW_TO_USE) {
            TableItem(onClick = { Nav.go(Route.RULES) }, modifier = Modifier.onboardingTarget(Target.HOW_TO_USE)) { TableText(t("howToUse")) }
        }
        // Account
        row { Divider(); AccountInfo() }
        row { LoginLogoutButtons() }
        // Todos
        row { Divider(); SectionHeader(t("todos")); TodoSettings() }
        // Delegation
        if (user != null) row { Divider(); SectionHeader(t("delegate.title")); DelegationSettings() }
        // General
        row {
            Divider()
            SectionHeader(t("general"))
            if (user != null) {
                TableItem(onClick = { Nav.go(Route.SOCKETS) }) { TableText(t("socketsInfo"), Modifier.weight(1f)); CheckOrCross(Sync.connected) }
                TableItem(onClick = { Nav.go(Route.DATA) }) { TableText(t("dataInfo")) }
            }
            LanguageAndColorMode()
        }
        row(Target.INTEGRATIONS_BUTTON) {
            TableItem(onClick = { Nav.go(if (user != null) Route.INTEGRATIONS else Route.login()) }, modifier = Modifier.onboardingTarget(Target.INTEGRATIONS_BUTTON)) {
                TableText(t("integrations"))
            }
        }
        row { GeneralSwitches() }
        // Information
        row {
            Divider()
            SectionHeader(t("info"))
            TableItem(onClick = {
                Onboarding.tutorialIsShown = false
                Onboarding.nextStep(TutorialStep.Start)
            }) { TableText(t("tutorialButton")) }
            TableItem(onClick = { Nav.go(Route.TERMS) }) { TableText(t("termsOfUse")) }
            TableItem(onClick = { Nav.go(Route.PRIVACY) }) { TableText(t("privacyPolicy")) }
        }
        row(Target.SUPPORT_BUTTON) {
            TableItem(onClick = { Ui.support() }, modifier = Modifier.onboardingTarget(Target.SUPPORT_BUTTON)) { TableText(t("supportLabel")) }
        }
        row {
            Divider()
            TableItem { TableText("v${BuildConfig.VERSION_NAME}${if (BuildConfig.DEBUG) ".dev" else ""}") }
        }
    }
}

@Composable
private fun InfoRow(title: String, value: String) {
    TableItem(onClick = {
        Ui.copy(value)
        Ui.toast("\"$value\" ${t("copied")}")
    }) {
        TableText(title)
        TableText(if (value.length <= 30) value else "${value.take(30)}...", Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun AccountInfo() {
    SectionHeader(t("account"))
    val user = Session.user
    if (user == null) {
        TableItem { TableText(t("anonymousText")) }
        return
    }
    var loading by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    val context = LocalContext.current
    if (loading) Spinner()
    if (!editing) {
        TableItem(onClick = { name = user.name; editing = true }) {
            TableText(t("nameLabel"))
            TableText(if (user.name.length <= 20) user.name else "${user.name.take(20)}...", Modifier.padding(start = 8.dp))
        }
    } else {
        TableItem {
            SettingsField(name, { name = it.trim() }, t("nameLabel"), Modifier.weight(1f), singleLine = false)
            MIcon(MaterialIcons.Filled.Close, Colors.border, modifier = Modifier.padding(horizontal = 8.dp)) { editing = false }
            if (name.isNotEmpty() && name != user.name) MIcon(MaterialIcons.Filled.Done, Colors.border, modifier = Modifier.padding(end = 8.dp)) {
                editing = false
                loading = true
                Ui.launch {
                    try {
                        Rest.setUserName(name, user.token)
                        // The RN app didn't refresh the user, so the old name stayed until the next full sync
                        Sync.request(Sync.Kind.User)
                    } catch (e: Exception) {
                        Ui.error(e.message ?: "$e")
                    } finally {
                        loading = false
                    }
                }
            }
        }
    }
    user.email?.let { InfoRow(t("email"), it) }
    user.facebookId?.let { InfoRow(t("facebook"), it) }
    user.telegramId?.let { InfoRow(t("telegram"), it) }
    user.appleSubId?.let { InfoRow(t("apple"), it) }
    TableItem(onClick = {
        scanQr(context) { uuid ->
            loading = true
            Ui.launch {
                try { Rest.setQrToken(uuid, user.token) } catch (e: Exception) { Ui.error(e.message ?: "$e") } finally { loading = false }
            }
        }
    }) { TableText(t("addDevices")) }
}

@Composable
private fun LoginLogoutButtons() {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp)) {
        if (Session.user != null) {
            PrimaryButton(t("logout")) { Ui.confirm(t("logoutText"), t("logout")) { Account.logout() } }
        } else {
            PrimaryButton(t("loginButton")) { Nav.go(Route.login()) }
            Text(t("alreadyRegistered"), color = Colors.text, fontFamily = com.todorant.ui.Fonts.textRegular, modifier = Modifier.padding(vertical = 12.dp))
        }
    }
}

/** A row with a time value, a clear button and the system time picker */
@Composable
private fun TimePickerRow(title: String, value: String, pickerValue: LocalTime, showClear: Boolean, onClear: () -> Unit, onSet: (String) -> Unit) {
    val context = LocalContext.current
    TableItem(onClick = {
        TimePickerDialog(context, { _, h, m -> onSet(LocalTime.of(h, m).hhmm()) }, pickerValue.hour, pickerValue.minute, true).show()
    }) {
        TableText(t(title), Modifier.weight(1f))
        TableText(value)
        if (showClear) MIcon(MaterialIcons.Filled.Close, Colors.border, modifier = Modifier.padding(start = 10.dp), onClick = onClear)
    }
}

/** Synced setting switch */
@Composable
private fun SyncedSwitch(title: String, value: Boolean?, set: (Boolean) -> Unit) = TextAndSwitch(title, value == true) {
    set(it)
    Settings.touch()
    Sync.request(Sync.Kind.Settings)
}

@Composable
private fun TodoSettings() {
    val context = LocalContext.current
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    SyncedSwitch("defaultToToday", Settings.showTodayOnAddTodo) { Settings.showTodayOnAddTodo = it }
    SyncedSwitch("newTodosGoOnTop", Settings.newTodosGoFirst) { Settings.newTodosGoFirst = it }
    SyncedSwitch("preserveOrderByTime", Settings.preserveOrderByTime) { Settings.preserveOrderByTime = it }
    // Local only, the RN app needlessly bumped the settings version for it
    TextAndSwitch("askBeforeDelete", Settings.askBeforeDelete) { Settings.askBeforeDelete = it }
    SyncedSwitch("settingsObject.duplicateTagInBreakdown", Settings.duplicateTagInBreakdown) { Settings.duplicateTagInBreakdown = it }
    SyncedSwitch("settingsObject.showMoreByDefault", Settings.showMoreByDefault) { Settings.showMoreByDefault = it }
    SyncedSwitch("settingsObject.removeCompletedFromCalendar", Settings.removeCompletedFromCalendar) { Settings.removeCompletedFromCalendar = it }
    TableItem(onClick = {
        Ui.actionSheet(null, (0..6).map { t("weekday$it") }) {
            Settings.firstDayOfWeek = it
            Settings.touch()
            Sync.request(Sync.Kind.Settings)
        }
    }) {
        TableText(t("firstDayOfWeek"), Modifier.weight(1f))
        TableText(t("weekday${Settings.firstDayOfWeekSafe}"))
    }
    TimePickerRow(
        "startTimeOfDay", Settings.startTimeOfDaySafe, parseTime(Settings.startTimeOfDaySafe) ?: LocalTime.MIDNIGHT,
        showClear = Settings.startTimeOfDaySafe != "00:00",
        onClear = { Settings.startTimeOfDay = "00:00"; Settings.touch(); Sync.request(Sync.Kind.Settings) },
    ) {
        Settings.startTimeOfDay = it
        Settings.touch()
        Sync.request(Sync.Kind.Settings)
    }
    TimePickerRow(
        "planningReminderTime", Settings.planningReminderTime ?: t("notSet"), parseTime(Settings.planningReminderTime) ?: LocalTime.MIDNIGHT,
        showClear = Settings.planningReminderTime != null,
        onClear = { Settings.planningReminderTime = null; Reminders.stop() },
    ) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        Settings.planningReminderTime = it
        Reminders.schedule(it)
    }
    TableItem(onClick = { Nav.go(Route.TAGS) }) { TableText(t("tags")) }
}

@Composable
private fun DelegationSettings() {
    TableItem(onClick = {
        Ui.copy(Session.delegateInviteLink)
        Ui.toast("\"${Session.delegateInviteLink}\" ${t("copied")}")
    }) {
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            TableText(t("delegate.link"))
            Text("${Session.delegateInviteLink.take(30)}...", color = Colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.alpha(0.4f))
        }
        MIcon(MaterialIcons.Filled.Refresh, Colors.border, modifier = Modifier.padding(start = 10.dp)) {
            Ui.actionSheet(t("delegate.resetConfirmation"), listOf(t("delegate.resetLink"))) {
                val token = Session.user?.token ?: return@actionSheet
                Ui.launch {
                    try {
                        val inviteToken = Rest.resetDelegateToken(token)
                        Session.user?.let { u -> Session.setUser(u.with { put("delegateInviteToken", inviteToken) }) }
                    } catch (e: Exception) {
                        Ui.error(e.message ?: "$e")
                    }
                }
            }
        }
    }
    TableItem(onClick = { Nav.go(Route.DELEGATORS) }) { TableText(t("delegate.delegators")) }
    TableItem(onClick = { Nav.go(Route.DELEGATES) }) { TableText(t("delegate.delegates")) }
}

private val languageNames = linkedMapOf(
    "en" to "English", "ru" to "Русский", "uk" to "Українська", "it" to "Italiano", "es" to "Español", "pt-br" to "Português Brasileiro",
)

@Composable
private fun LanguageAndColorMode() {
    TableItem(onClick = {
        Ui.actionSheet(null, listOf(t("languageAuto")) + languageNames.values) { i ->
            val code = if (i == 0) "auto" else languageNames.keys.elementAt(i - 1)
            Settings.languageSelect = code
            // The RN app only applied "auto" after a restart
            Settings.language = if (i == 0) I18n.languageTag() else code
            Settings.touch()
            Sync.request(Sync.Kind.Settings)
        }
    }) {
        TableText(t("languageSelect"), Modifier.weight(1f))
        TableText(if (Settings.languageSelect == "auto") t("languageAuto") else languageNames[Settings.language ?: "en"] ?: "English")
    }
    val modes = listOf(ColorMode.auto to "languageAuto", ColorMode.dark to "dark", ColorMode.light to "light")
    TableItem(onClick = { Ui.actionSheet(null, modes.map { t(it.second) }) { Settings.colorMode = modes[it].first } }) {
        TableText(t("colorMode"), Modifier.weight(1f))
        TableText(t(modes.first { it.first == Settings.colorMode }.second))
    }
}

@Composable
private fun GeneralSwitches() {
    if (Session.user != null) TableItem(onClick = { Nav.go(Route.SECURITY) }) { TableText(t("security")) }
    TextAndSwitch("soundEffects", Settings.soundOn) { Settings.soundOn = it }
    if (!Settings.soundOn) TextAndSwitch("endOfDaySoundOn", Settings.endOfDaySoundOn) { Settings.endOfDaySoundOn = it }
    TextAndSwitch("gamification", Settings.gamificationOn) { Settings.gamificationOn = it }
    TextAndSwitch("badgeIconCurrentCount", Settings.badgeIconCurrentCount) { Settings.badgeIconCurrentCount = it; Widget.refresh() }
    TextAndSwitch("settingsActions.swipeActions", Settings.swipeActions) { Settings.swipeActions = it }
}
