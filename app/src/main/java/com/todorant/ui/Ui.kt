package com.todorant.ui

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.todorant.App
import com.todorant.R
import com.todorant.data.Settings
import com.todorant.t
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.random.Random

/** One alert or action sheet. Buttons run after the dialog closes. */
class DialogSpec(
    val title: String?,
    val message: String?,
    val buttons: List<Pair<String, () -> Unit>>,
    val destructive: Set<Int> = emptySet(),
)

/** Alerts, action sheets and toasts — Alert.alert / ActionSheet / Toast from the RN app */
object Ui {
    val dialogs = mutableStateListOf<DialogSpec>()

    fun launch(block: suspend CoroutineScope.() -> Unit) = App.scope.launch(Dispatchers.Main, block = block)

    private fun show(spec: DialogSpec) = App.scope.launch(Dispatchers.Main) { dialogs.add(spec) }

    fun alert(title: String?, message: String?, buttons: List<Pair<String, () -> Unit>> = listOf(t("ok") to {})) =
        show(DialogSpec(title, message, buttons))

    fun message(title: String, message: String, ok: () -> Unit = {}) = alert(title, message, listOf(t("ok") to ok))

    fun error(error: String, confirmText: String? = null, confirm: (() -> Unit)? = null) = alert(
        t("error"), error,
        if (confirmText != null && confirm != null) listOf(confirmText to confirm, t("ok") to {}) else listOf(t("ok") to {})
    )

    fun confirm(message: String, confirmText: String, title: String? = null, onConfirm: () -> Unit) =
        show(DialogSpec(title ?: t("pleaseConfirm"), message, listOf(t("cancel") to {}, confirmText to onConfirm)))

    /** Options plus a cancel button; [onPick] gets the option index */
    fun actionSheet(title: String?, options: List<String>, destructive: Set<Int> = emptySet(), onPick: (Int) -> Unit) = show(
        DialogSpec(
            title?.ifEmpty { null }, null,
            options.mapIndexed { i, o -> o to { onPick(i) } } + (t("cancel") to {}), destructive
        )
    )

    fun toast(text: String) = App.scope.launch(Dispatchers.Main) { Toast.makeText(App.context, text, Toast.LENGTH_SHORT).show() }

    fun support() = alert(
        t("supportLabel"), t("supportText"),
        listOf(
            t("cancel") to {},
            "n@borodutch.com" to { openUrl("mailto:n@borodutch.com") },
            "@borodutch" to { openUrl("https://t.me/borodutch") },
        )
    )

    fun info(message: String) = alert(t("infoTitle"), t(message), listOf(t("supportLabel") to { support() }, t("ok") to {}))

    fun openUrl(url: String) = runCatching {
        App.context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun copy(text: String) {
        val clipboard = App.context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("text", text))
    }

    fun paste(): String {
        val clipboard = App.context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        return clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(App.context)?.toString() ?: ""
    }
}

@Composable
fun DialogHost() {
    val spec = Ui.dialogs.firstOrNull() ?: return
    fun close(action: () -> Unit) { Ui.dialogs.remove(spec); action() }
    AlertDialog(
        onDismissRequest = { Ui.dialogs.remove(spec) },
        containerColor = Colors.cardBackground,
        title = spec.title?.let { { Text(it, color = Colors.text) } },
        text = spec.message?.let { { Text(it, color = Colors.text, modifier = Modifier.verticalScroll(rememberScrollState())) } },
        confirmButton = {
            if (spec.buttons.size <= 2) {
                spec.buttons.forEachIndexed { i, (label, action) ->
                    TextButton(onClick = { close(action) }) {
                        Text(label, color = if (i in spec.destructive) Colors.destruct else Colors.primary)
                    }
                }
            } else {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    spec.buttons.forEachIndexed { i, (label, action) ->
                        TextButton(onClick = { close(action) }) {
                            Text(label, color = if (i in spec.destructive) Colors.destruct else Colors.primary)
                        }
                    }
                }
            }
        },
    )
}

/** All app routes. Tabs: current, planning, delegation, settings. */
object Route {
    const val CURRENT = "current"
    const val PLANNING = "planning"
    const val DELEGATION = "delegation"
    const val SETTINGS = "settings"
    val tabs = listOf(CURRENT, PLANNING, DELEGATION, SETTINGS)

    const val ADD = "add?date={date}&text={text}"
    const val EDIT = "edit/{id}"
    const val BREAKDOWN = "breakdown/{id}"
    const val LOGIN = "login?wall={wall}"
    const val TERMS = "terms"
    const val PRIVACY = "privacy"
    const val TELEGRAM = "telegram"
    const val HERO = "hero"
    const val RULES = "rules"
    const val SOCKETS = "sockets"
    const val DATA = "data"
    const val TAGS = "tags"
    const val COLOR_PICKER = "colorPicker/{id}"
    const val ADD_EPIC = "addEpic/{id}"
    const val CHANGE_TEXT = "changeText/{id}"
    const val INTEGRATIONS = "integrations"
    const val GOOGLE_CALENDAR = "googleCalendar"
    const val SECURITY = "security"
    const val DELEGATORS = "delegators"
    const val DELEGATES = "delegates"

    private fun enc(s: String?) = Uri.encode(s ?: "")
    fun add(date: String? = null, text: String? = null) = "add?date=${enc(date)}&text=${enc(text)}"
    fun edit(id: String) = "edit/$id"
    fun breakdown(id: String) = "breakdown/$id"
    fun login(wall: Boolean = false) = "login?wall=$wall"
    fun colorPicker(id: String) = "colorPicker/$id"
    fun addEpic(id: String) = "addEpic/$id"
    fun changeText(id: String) = "changeText/$id"
}

object Nav {
    var controller: NavHostController? = null

    fun go(route: String) = App.scope.launch(Dispatchers.Main) {
        val c = controller ?: return@launch
        if (route in Route.tabs) {
            c.navigate(route) {
                popUpTo(c.graph.startDestinationId) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        } else c.navigate(route)
    }

    fun back() = App.scope.launch(Dispatchers.Main) { controller?.popBackStack() }

    fun currentRoute() = controller?.currentBackStackEntry?.destination?.route
}

/** Confetti and the "mission passed" overlay */
object Effects {
    var confettiKey by mutableIntStateOf(0)
    var dayCompleteKey by mutableIntStateOf(0)

    /** Shows confetti one time in five, or always with [force] */
    fun confetti(force: Boolean = false) {
        if (!force && Random.nextInt(5) != 0) return
        App.scope.launch(Dispatchers.Main) { confettiKey++ }
    }

    fun dayComplete() = App.scope.launch(Dispatchers.Main) { dayCompleteKey++ }
}

object Sounds {
    private lateinit var pool: SoundPool
    private val ids = HashMap<Int, Int>()

    fun init(context: Context) {
        pool = SoundPool.Builder().setMaxStreams(2)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).build()).build()
        for (res in listOf(R.raw.level_up, R.raw.nice, R.raw.task_done, R.raw.day_complete)) ids[res] = pool.load(context, res, 1)
    }

    private fun play(res: Int) {
        if (!Settings.soundOn && !Settings.endOfDaySoundOn) return
        ids[res]?.let { pool.play(it, 1f, 1f, 1, 0, 1f) }
    }

    fun frogComplete() = play(if (Random.nextInt(10) == 0) R.raw.nice else R.raw.level_up)
    fun taskComplete() = play(R.raw.task_done)
    fun dayComplete() = play(R.raw.day_complete)
}
