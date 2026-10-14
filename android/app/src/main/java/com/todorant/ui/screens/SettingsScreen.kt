package com.todorant.ui.screens

import android.Manifest
import android.app.TimePickerDialog
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.todorant.BuildConfig
import com.todorant.I18n
import com.todorant.Reminders
import com.todorant.data.ColorMode
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.logic.Account
import com.todorant.logic.ellipsize
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
import com.todorant.ui.ValueRow
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
        if (Sync.connected) runCatching { Sync.sync() }.onFailure(Ui::error)
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
        row {
            Divider()
            AccountInfo()
            ServerSetting { address, open -> ValueRow(t("server"), address.ellipsize(30), open) }
        }
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
    }) {
        TableText(title)
        TableText(value.ellipsize(30), Modifier.padding(start = 8.dp))
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
    val shown = Session.name.ifEmpty { user.name }
    if (!editing) {
        TableItem(onClick = { name = shown; editing = true }) {
            TableText(t("nameLabel"))
            TableText(if (shown.length <= 20) shown else "${shown.take(20)}...", Modifier.padding(start = 8.dp))
        }
    } else {
        TableItem {
            SettingsField(name, { name = it.trim() }, t("nameLabel"), Modifier.weight(1f), singleLine = false)
            MIcon(MaterialIcons.Filled.Close, Colors.border, modifier = Modifier.padding(horizontal = 8.dp)) { editing = false }
            if (name.isNotEmpty() && name != shown) MIcon(MaterialIcons.Filled.Done, Colors.border, modifier = Modifier.padding(end = 8.dp)) {
                editing = false
                // Synced like any edit; the RN app kept showing the old name until the next full sync
                Session.name = name
            }
        }
    }
    user.email?.let { InfoRow(t("email"), it) }
    user.facebookId?.let { InfoRow(t("facebook"), it) }
    user.telegramId?.let { InfoRow(t("telegram"), it) }
    user.appleSubId?.let { InfoRow(t("apple"), it) }
    user.passwordLogin?.let { InfoRow(t("email"), it) }
    TableItem(onClick = {
        scanQr(context) { uuid ->
            // The scanned page gets this account's token: a QR shown by someone else would hand it to them
            Ui.confirm(t("addDevicesConfirm"), t("addDevices")) {
                loading = true
                Ui.attempt({ loading = false }) { Rest.setQrToken(uuid) }
            }
        }
    }) { TableText(t("addDevices")) }
    TableItem(onClick = {
        Ui.confirm(t("deleteAccountText"), t("deleteAccount"), destructive = true) {
            loading = true
            Ui.attempt({ loading = false }) {
                Rest.deleteAccount()
                Account.logout()
            }
        }
    }) { TableText(t("deleteAccount"), color = Colors.destruct) }
}

/** The server: [label] shows its address and opens an editor; empty means todorant's own */
@Composable
internal fun ServerSetting(label: @Composable (address: String, open: () -> Unit) -> Unit) {
    var draft by remember { mutableStateOf<String?>(null) }
    val value = draft ?: return label(Rest.base.substringAfter("://")) { draft = Rest.base }
    TableItem {
        SettingsField(value, { draft = it }, BuildConfig.API.substringAfter("://"), Modifier.weight(1f), keyboardType = KeyboardType.Uri)
        MIcon(MaterialIcons.Filled.Close, Colors.border, modifier = Modifier.padding(horizontal = 8.dp)) { draft = null }
        MIcon(MaterialIcons.Filled.Done, Colors.border, modifier = Modifier.padding(end = 8.dp)) { Account.changeServer(value) { draft = null } }
    }
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

@Composable
private fun TodoSettings() {
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    TextAndSwitch("defaultToToday", Settings.showTodayOnAddTodo == true) { Settings.showTodayOnAddTodo = it }
    TextAndSwitch("newTodosGoOnTop", Settings.newTodosGoFirst == true) { Settings.newTodosGoFirst = it }
    TextAndSwitch("preserveOrderByTime", Settings.preserveOrderByTime == true) { Settings.preserveOrderByTime = it }
    // Local only, the RN app needlessly bumped the settings version for it
    TextAndSwitch("askBeforeDelete", Settings.askBeforeDelete) { Settings.askBeforeDelete = it }
    TextAndSwitch("settingsObject.duplicateTagInBreakdown", Settings.duplicateTagInBreakdown == true) { Settings.duplicateTagInBreakdown = it }
    TextAndSwitch("settingsObject.showMoreByDefault", Settings.showMoreByDefault == true) { Settings.showMoreByDefault = it }
    TextAndSwitch("settingsObject.removeCompletedFromCalendar", Settings.removeCompletedFromCalendar == true) { Settings.removeCompletedFromCalendar = it }
    ValueRow(t("firstDayOfWeek"), t("weekday${Settings.firstDayOfWeekSafe}")) {
        Ui.actionSheet(null, (0..6).map { t("weekday$it") }) { Settings.firstDayOfWeek = it }
    }
    TimePickerRow(
        "startTimeOfDay", Settings.startTimeOfDaySafe, parseTime(Settings.startTimeOfDaySafe) ?: LocalTime.MIDNIGHT,
        showClear = Settings.startTimeOfDaySafe != "00:00",
        onClear = { Settings.startTimeOfDay = "00:00" },
    ) {
        Settings.startTimeOfDay = it
    }
    TimePickerRow(
        "planningReminderTime", Settings.planningReminderTime ?: t("notSet"), parseTime(Settings.planningReminderTime) ?: LocalTime.MIDNIGHT,
        showClear = Settings.planningReminderTime != null,
        onClear = { Settings.planningReminderTime = null; Reminders.stop() },
    ) {
        if (Reminders.permissionNeeded()) {
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
    }) {
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            TableText(t("delegate.link"))
            Text("${Session.delegateInviteLink.take(30)}...", color = Colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.alpha(0.4f))
        }
        MIcon(MaterialIcons.Filled.Refresh, Colors.border, modifier = Modifier.padding(start = 10.dp)) {
            Ui.actionSheet(t("delegate.resetConfirmation"), listOf(t("delegate.resetLink"))) {
                Ui.attempt {
                    val inviteToken = Rest.resetDelegateToken()
                    Session.user?.let { u -> Session.setUser(u.with { put("delegateInviteToken", inviteToken) }) }
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
        }
    }) {
        TableText(t("languageSelect"), Modifier.weight(1f))
        TableText(if (Settings.languageSelect == "auto") t("languageAuto") else languageNames[Settings.language ?: "en"] ?: "English")
    }
    val modes = listOf(ColorMode.auto to "languageAuto", ColorMode.dark to "dark", ColorMode.light to "light")
    ValueRow(t("colorMode"), t(modes.first { it.first == Settings.colorMode }.second)) {
        Ui.actionSheet(null, modes.map { t(it.second) }) { Settings.colorMode = modes[it].first }
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
