package com.todorant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Done
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.Db
import com.todorant.data.Db.saveTag
import com.todorant.data.Db.saveTodo
import com.todorant.data.Db.saveUser
import com.todorant.data.Hero
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.Tag
import com.todorant.data.Todo
import com.todorant.data.millisToIso
import com.todorant.logic.Crypto
import com.todorant.logic.Todos
import com.todorant.sync.Rest
import com.todorant.sync.Sync
import com.todorant.t
import com.todorant.ui.CheckOrCross
import com.todorant.ui.Colors
import com.todorant.ui.Divider
import com.todorant.ui.IconBtn
import com.todorant.ui.InfoButton
import com.todorant.ui.MIcon
import com.todorant.ui.Nav
import com.todorant.ui.PrimaryButton
import com.todorant.ui.Route
import com.todorant.ui.SectionHeader
import com.todorant.ui.Spinner
import com.todorant.ui.StackScreen
import com.todorant.ui.TableItem
import com.todorant.ui.TableText
import com.todorant.ui.TodorantSwitch
import com.todorant.ui.Ui
import com.todorant.ui.dbState
import com.todorant.ui.hex
import com.todorant.ui.regularText
import com.todorant.ui.toHex
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// region Helpers shared by the settings screens

@Composable
internal fun SettingsField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier.fillMaxWidth(),
    password: Boolean = false,
    number: Boolean = false,
    color: Color = Colors.text,
    textAlign: TextAlign = TextAlign.Start,
    singleLine: Boolean = true,
) {
    TextField(
        value, onChange, modifier,
        placeholder = { Text(placeholder, color = Colors.placeholder, textAlign = textAlign, modifier = Modifier.fillMaxWidth()) },
        singleLine = singleLine,
        textStyle = TextStyle(color = color, fontSize = 18.sp, textAlign = textAlign),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
            keyboardType = when { password -> KeyboardType.Password; number -> KeyboardType.Number; else -> KeyboardType.Text },
            autoCorrectEnabled = !password,
        ),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
            focusedIndicatorColor = Colors.primary, unfocusedIndicatorColor = Colors.border, cursorColor = Colors.primary,
        ),
    )
}

/** Header "done" button of the tag editing screens */
@Composable
private fun DoneAction(onClick: () -> Unit) = MIcon(MaterialIcons.Filled.Done, Colors.primary, 28.dp, Modifier.padding(end = 12.dp), onClick)

/** A saturation/value square plus a hue slider */
@Composable
internal fun HsvPicker(color: Color, onChange: (Color) -> Unit, modifier: Modifier = Modifier) {
    val hsv = remember(color) { FloatArray(3).also { android.graphics.Color.colorToHSV(color.toArgbInt(), it) } }
    var hue by remember { mutableStateOf(hsv[0]) }
    fun emit(h: Float, s: Float, v: Float) = onChange(Color(android.graphics.Color.HSVToColor(floatArrayOf(h, s, v))))
    Column(modifier.widthIn(max = 320.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(1f).clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))) {
            val w = constraints.maxWidth.toFloat()
            val h = constraints.maxHeight.toFloat()
            fun pick(x: Float, y: Float) = emit(hue, (x / w).coerceIn(0f, 1f), 1 - (y / h).coerceIn(0f, 1f))
            Box(
                Modifier.fillMaxSize()
                    .background(Brush.horizontalGradient(listOf(Color.White, Color(android.graphics.Color.HSVToColor(floatArrayOf(hue, 1f, 1f))))))
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black)))
                    .pointerInput(hue) { detectTapGestures { pick(it.x, it.y) } }
                    .pointerInput(hue) { detectDragGestures { change, _ -> pick(change.position.x, change.position.y) } }
            )
            val density = LocalDensity.current
            Box(
                Modifier.offset(with(density) { (hsv[1] * w).toDp() - 10.dp }, with(density) { ((1 - hsv[2]) * h).toDp() - 10.dp })
                    .size(20.dp).border(2.dp, Color.White, CircleShape)
            )
        }
        Slider(
            hue, { hue = it; emit(it, hsv[1].coerceAtLeast(0.05f), hsv[2].coerceAtLeast(0.05f)) }, valueRange = 0f..359f,
            colors = SliderDefaults.colors(thumbColor = Color(android.graphics.Color.HSVToColor(floatArrayOf(hue, 1f, 1f))), activeTrackColor = Colors.border, inactiveTrackColor = Colors.border),
        )
    }
}

private fun Color.toArgbInt() = android.graphics.Color.parseColor(toHex())

private val dateTimeFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

// endregion

@Composable
fun RulesScreen() {
    StackScreen(t("howTo"), actions = { InfoButton("infoRules") }) {
        LazyColumn(Modifier.fillMaxSize()) {
            items((0..16).toList()) { i ->
                Text("${i + 1}. ${t("rules.$i")}", color = Colors.text, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

@Composable
fun SocketsScreen() {
    StackScreen(t("socketsInfo"), actions = { InfoButton("infoSockets") }) {
        Spacer(Modifier.height(16.dp))
        TableItem { TableText(t("connected")); CheckOrCross(Sync.connected) }
        TableItem { TableText(t("authorized")); CheckOrCross(Sync.authorized) }
        Sync.connectionError?.let { error ->
            TableItem { TableText(t("socketError")); TableText(error, Modifier.padding(start = 8.dp)) }
        }
    }
}

private fun cloneUser(id: String?, delegator: Boolean): Any = id?.let {
    val name = Db.users("server_id = ? AND is_delegator = ?", arrayOf(it, if (delegator) "1" else "0")).firstOrNull()?.name
        ?: Session.user?.takeIf { u -> u.id == it }?.name
    JSONObject().put("_id", it).put("name", name ?: JSONObject.NULL)
} ?: JSONObject.NULL

/** cloneTodo from the RN app. Encrypted texts are sent encrypted (the RN app sent them decrypted). */
private fun cloneTodo(todo: Todo) = JSONObject().apply {
    val key = Session.encryptionKey
    put("_tempSyncId", todo.id); put("id", todo.id); put("_id", todo.serverId ?: JSONObject.NULL)
    put("_exactDate", millisToIso(todo.exactDate)); put("createdAt", millisToIso(todo.createdAt)); put("updatedAt", millisToIso(todo.updatedAt))
    put("text", if (todo.encrypted && key != null) Crypto.encrypt(todo.text, key) else todo.text)
    put("completed", todo.completed); put("frog", todo.frog); put("frogFails", todo.frogFails); put("skipped", todo.skipped)
    put("order", todo.order); put("monthAndYear", todo.monthAndYear ?: JSONObject.NULL); put("deleted", todo.deleted)
    put("encrypted", todo.encrypted); put("date", todo.date ?: JSONObject.NULL); put("time", todo.time ?: JSONObject.NULL)
    put("repetitive", todo.repetitive)
    put("user", cloneUser(todo.userId, false)); put("delegator", cloneUser(todo.delegatorId, true))
    put("delegateAccepted", todo.delegateAccepted ?: JSONObject.NULL)
}

private fun cloneTag(tag: Tag) = JSONObject().apply {
    put("_tempSyncId", tag.id); put("id", tag.id); put("_id", tag.serverId ?: JSONObject.NULL)
    put("createdAt", millisToIso(tag.createdAt)); put("updatedAt", millisToIso(tag.updatedAt)); put("deleted", tag.deleted)
    put("tag", tag.tag); put("color", tag.color ?: JSONObject.NULL); put("numberOfUses", tag.numberOfUses)
    put("epic", tag.epic ?: JSONObject.NULL); put("epicGoal", tag.epicGoal ?: JSONObject.NULL)
    put("epicCompleted", tag.epicCompleted ?: JSONObject.NULL); put("epicPoints", tag.epicPoints ?: JSONObject.NULL)
    put("epicOrder", tag.epicOrder ?: JSONObject.NULL)
}

@Composable
fun DataScreen() {
    val me = Session.user?.id ?: ""
    val counts = dbState(initial = listOf(0, 0, 0, 0)) {
        listOf(
            Db.count("todos", Db.UNDELETED), Db.count("tags", "is_deleted = 0"),
            Db.count("users", "is_delegator = 1 AND is_deleted = 0 AND server_id IS NOT ?", arrayOf(me)),
            Db.count("users", "is_delegator = 0 AND is_deleted = 0 AND server_id IS NOT ?", arrayOf(me)),
        )
    }
    fun date(millis: Long?) = millis?.let { dateTimeFormat.format(Date(it)) } ?: t("notSyncedYet")
    StackScreen(t("dataInfo"), actions = { InfoButton("infoData") }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            SectionHeader(t("count"))
            for ((title, value) in listOf("todoCount", "tagsCount", "delegate.delegators", "delegate.delegates").zip(counts)) {
                TableItem { TableText(t(title), Modifier.weight(1f)); TableText("$value") }
            }
            Divider()
            SectionHeader(t("sync"))
            TableItem { TableText(t("settingsLastSync"), Modifier.weight(1f)); TableText(date(Settings.updatedAt)) }
            TableItem { TableText(t("accountLastSync"), Modifier.weight(1f)); TableText(date(Session.user?.updatedAt)) }
            TableItem { TableText(t("gamification"), Modifier.weight(1f)); TableText(date(Hero.updatedAt)) }
            Divider()
            TableItem(onClick = { Ui.launch { runCatching { Sync.sync(Sync.Kind.All) }.onFailure { Ui.error(it.message ?: "$it") } } }) {
                TableText(t("syncData"))
            }
            TableItem(onClick = { Ui.launch { runCatching { Sync.hardSync() }.onFailure { Ui.error(it.message ?: "$it") } } }) {
                TableText(t("syncDataHard"))
            }
            TableItem(onClick = { Ui.launch { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Todos.recalculateExactDates() } } }) {
                TableText(t("syncExactDates"))
            }
            TableItem(onClick = { sendDataToServer() }) { TableText(t("sendDataToServer")) }
        }
    }
}

private fun sendDataToServer() {
    val token = Session.user?.token ?: return
    Ui.launch {
        val (todos, tags) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Db.todos() to Db.tags() }
        try {
            Rest.sendData(JSONObject().put("todos", JSONArray(todos.map(::cloneTodo))).put("tags", JSONArray(tags.map(::cloneTag))), token)
        } catch (e: Exception) {
            Ui.error(e.message ?: "$e")
        }
        // Re-push everything
        Db.write { todos.forEach { saveTodo(it) }; tags.forEach { saveTag(it) } }
        runCatching { Sync.sync(Sync.Kind.All) }
        Ui.toast("👍")
    }
}

@Composable
fun TagsScreen() {
    val tags = dbState(initial = emptyList<Tag>()) { Db.undeletedTags() }
    StackScreen(t("tags"), actions = { InfoButton("infoTags") }) {
        LazyColumn(Modifier.fillMaxSize()) {
            if (tags.isNotEmpty()) item {
                TableItem(onClick = {
                    Ui.alert(t("deleteAllHashtagsConfirm"), null, listOf(
                        t("delete") to {
                            Db.write { Db.undeletedTags().forEach { it.deleted = true; saveTag(it) } }
                            Sync.request(Sync.Kind.Tag)
                        },
                        t("cancel") to {},
                    ))
                }) { TableText(t("deleteAllHashtags"), Modifier.padding(top = 8.dp), Colors.destruct) }
            } else item {
                Text(t("emptyHashtags"), style = regularText, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(20.dp))
            }
            items(tags, key = { it.id }) { tag ->
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("#${tag.tag}", color = tag.color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.link, fontFamily = com.todorant.ui.Fonts.textRegular, modifier = Modifier.weight(1f))
                        IconBtn("target_outline_28", if (tag.epic == true) Color.Gray else null) {
                            if (tag.epic == true) unEpic(tag) else Nav.go(Route.addEpic(tag.id))
                        }
                        IconBtn("edit_outline_28") { Nav.go(Route.changeText(tag.id)) }
                        IconBtn("delete_outline_28-iOS", Colors.destruct) {
                            Ui.confirm("${t("deleteTodo")} \"#${tag.tag.short()}\"?", t("delete")) {
                                Db.updateTag(tag) { it.deleted = true }
                                Sync.request(Sync.Kind.Tag)
                            }
                        }
                    }
                    Divider(horizontal = 0.dp)
                }
            }
        }
    }
}

private fun String.short() = if (length > 50) "${take(50)}..." else this

private fun unEpic(tag: Tag) = Ui.confirm("${t("unEpicConfirm")} \"#${tag.tag.short()}\"?", t("unEpic")) {
    Db.updateTag(tag) { it.epicCompleted = false; it.epicGoal = 0; it.epicOrder = 0; it.epicPoints = 0; it.epic = false }
    Sync.request(Sync.Kind.Tag)
}

@Composable
private fun TagTitle(tag: Tag?, color: Color?, big: Boolean = false) = Text(
    "#${tag?.tag ?: ""}", color = color ?: tag?.color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.link,
    fontSize = if (big) 32.sp else 17.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(0.8f),
)

@Composable
fun ColorPickerScreen(tagId: String) {
    val tag = dbState(tagId, initial = null as Tag?) { Db.tag(tagId) }
    var color by remember { mutableStateOf<Color?>(null) }
    val current = color ?: tag?.color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.link
    StackScreen(t("changeColor"), actions = {
        DoneAction {
            tag?.let { Db.updateTag(it) { t -> t.color = current.toHex() } }
            Nav.back()
            Sync.request(Sync.Kind.Tag)
        }
    }) {
        Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            TagTitle(tag, current, big = true)
            Spacer(Modifier.height(20.dp))
            HsvPicker(current, { color = it })
        }
    }
}

@Composable
fun ChangeTextScreen(tagId: String) {
    val tag = dbState(tagId, initial = null as Tag?) { Db.tag(tagId) }
    var newName by remember { mutableStateOf("") }
    var color by remember { mutableStateOf<Color?>(null) }
    var pickerEnabled by remember { mutableStateOf(false) }
    val presets = if (Settings.isDark) listOf("#FFBE3D", "#FF984C", "#FF715B", "#6cdaaf", "#32A4C6", "#70bfd7", "#23738b", "#ab81d6")
    else listOf("#FFBE3D", "#FF984C", "#FF715B", "#2DCA8C", "#32A4C6", "#377DFF", "#4740D6", "#5603AD")
    StackScreen(t("editHashtag"), actions = { DoneAction { tag?.let { saveTagText(it, newName, color) } } }) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TagTitle(tag, color)
            SettingsField(newName, { newName = it.trim() }, t("editName"), Modifier.fillMaxWidth().padding(horizontal = 16.dp), textAlign = TextAlign.Center)
            Row(verticalAlignment = Alignment.CenterVertically) {
                for (c in presets) Box(Modifier.padding(horizontal = 6.dp).size(26.dp).clip(CircleShape).background(hex(c)).clickable { color = hex(c) })
                IconBtn(if (pickerEnabled) "cancel_outline_28--close" else "palette_outline_28") { pickerEnabled = !pickerEnabled }
            }
            if (pickerEnabled) HsvPicker(color ?: tag?.color?.takeIf { it.isNotEmpty() }?.let(::hex) ?: Colors.link, { color = it }, Modifier.fillMaxWidth(0.6f))
        }
    }
}

/** Renames a hashtag in all todos and recolors it */
private fun saveTagText(tag: Tag, newNameInput: String, color: Color?) {
    val newName = newNameInput.takeIf { Regex("^\\S+$").matches(it) }
    if (newName != null && newName != tag.tag) {
        // RN split words by spaces only, so tags next to line breaks weren't renamed
        val regex = Regex("(?<=^|\\s)#${Regex.escape(tag.tag)}(?=\\s|$)")
        val todos = Db.todos("${Db.UNDELETED} AND text LIKE ?", arrayOf("%#${tag.tag}%")).filter { regex.containsMatchIn(it.text) }
        Db.write { todos.forEach { it.text = it.text.replace(regex, "#$newName"); saveTodo(it) } }
    }
    Db.updateTag(tag) {
        it.tag = newName ?: tag.tag
        color?.let { c -> it.color = c.toHex() }
    }
    Nav.back()
    Sync.request(Sync.Kind.All)
}

@Composable
fun AddEpicScreen(tagId: String) {
    val tag = dbState(tagId, initial = null as Tag?) { Db.tag(tagId) }
    var goal by remember { mutableStateOf("") }
    StackScreen(t("epic.intoEpic"), actions = {
        DoneAction {
            val value = goal.toIntOrNull() ?: return@DoneAction
            if (value <= 0 || tag == null) return@DoneAction
            Db.updateTag(tag) { it.epic = true; it.epicGoal = value; it.epicPoints = 0 }
            Nav.back()
            Sync.request(Sync.Kind.Tag)
        }
    }) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            TagTitle(tag, null)
            SettingsField(
                goal, { goal = it.filter(Char::isDigit) }, t("epic.epicGoal"), Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                number = true, color = Color(0xFF008000), textAlign = TextAlign.Center,
            )
        }
    }
}

/** Google Calendar OAuth handoff between the integrations and the web view screens */
private object CalendarAuth {
    var url = ""
    var loading by mutableStateOf(false)

    fun authorize(code: String) {
        val token = Session.user?.token ?: return
        loading = true
        Ui.launch {
            try {
                Settings.googleCalendarCredentials = Rest.calendarAuthorize(code, token).toString()
                Settings.touch()
                Sync.request(Sync.Kind.Settings)
            } catch (e: Exception) {
                Ui.error(e.message ?: "$e")
            } finally {
                loading = false
            }
        }
    }
}

@Composable
fun IntegrationsScreen() {
    StackScreen(t("integrations"), actions = { InfoButton("infoIntegrations") }) {
        Spacer(Modifier.height(16.dp))
        TableItem(onClick = { Ui.confirm(t("googleCalendarHint"), t("googleCalendarGotIt")) { googleCalendarTapped() } }) {
            TableText(t("googleCalendar"))
            if (CalendarAuth.loading) Box(Modifier.size(25.dp)) { Spinner() }
            else TableText(t(if (Settings.googleCalendarCredentials != null) "connected" else "notConnected"))
        }
    }
}

private fun googleCalendarTapped() {
    val token = Session.user?.token ?: return
    if (Settings.googleCalendarCredentials != null) {
        Ui.actionSheet(null, listOf(t("disconnect")), destructive = setOf(0)) {
            Settings.googleCalendarCredentials = null
            Settings.touch()
            Sync.request(Sync.Kind.Settings)
        }
        return
    }
    CalendarAuth.loading = true
    Ui.launch {
        try {
            CalendarAuth.url = Rest.calendarAuthenticationURL(token)
            Nav.go(Route.GOOGLE_CALENDAR)
        } catch (e: Exception) {
            Ui.error(e.message ?: "$e")
        } finally {
            CalendarAuth.loading = false
        }
    }
}

@Composable
fun GoogleCalendarScreen() {
    var handled by remember { mutableStateOf(false) }
    WebPageScreen(
        t("googleCalendar"), CalendarAuth.url,
        configure = { it.settings.userAgentString = "Safari/537.36" },
        onPageStarted = { view, url ->
            val uri = android.net.Uri.parse(url)
            val code = if (uri.host == "accounts.google.com") null else runCatching { uri.getQueryParameter("code") }.getOrNull()
            if (!handled && !code.isNullOrEmpty()) {
                handled = true
                view.stopLoading()
                Nav.back()
                CalendarAuth.authorize(code)
            }
        },
    )
}

@Composable
fun SecurityScreen() {
    var encryptionOn by remember { mutableStateOf(Session.encryptionKey != null) }
    var password by remember { mutableStateOf(Session.encryptionKey ?: "") }
    var passwordRepeat by remember { mutableStateOf(Session.encryptionKey ?: "") }
    var loading by remember { mutableStateOf(false) }
    val ownWhere = "${Db.UNDELETED} AND delegator_id IS NULL AND is_encrypted = ?"
    val (encryptedCount, unencryptedCount) = dbState(initial = 0 to 0) { Db.count("todos", ownWhere, arrayOf("1")) to Db.count("todos", ownWhere, arrayOf("0")) }

    fun work(block: () -> Unit) {
        loading = true
        Ui.launch {
            try { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { block() } } catch (e: Exception) { Ui.error(e.message ?: "$e") } finally { loading = false }
        }
    }
    /** Marks all own todos as (un)encrypted; they get pushed (encrypted) on sync */
    fun changeEncrypted(encrypted: Boolean) = work {
        val todos = Db.todos(ownWhere, arrayOf(if (encrypted) "0" else "1"))
        Db.write { todos.forEach { it.encrypted = encrypted; saveTodo(it) } }
        Sync.request(Sync.Kind.Todo)
    }
    /** Local texts of encrypted todos are kept decrypted while a key is set, and as ciphertext without one */
    fun encryptEncrypted(encrypt: Boolean, key: String) = work {
        val todos = Db.todos(ownWhere, arrayOf("1"))
        Db.write {
            // RN replaced texts that failed to decrypt with ""; keep them as they are instead
            todos.forEach { it.text = if (encrypt) Crypto.encrypt(it.text, key) else Crypto.decrypt(it.text, key) ?: it.text; saveTodo(it, local = false) }
        }
        Sync.request(Sync.Kind.Todo)
    }

    StackScreen(t("security")) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            TableItem { TableText(t("infoSecurity")) }
            TableItem {
                TableText(t("encryptTodo"), Modifier.weight(1f))
                TodorantSwitch(encryptionOn, { value ->
                    if (value) encryptionOn = true
                    else if (Session.encryptionKey != null) Ui.confirm(t("encryptionDisableConfirm"), t("disable")) {
                        val key = Session.encryptionKey ?: return@confirm
                        Session.encryptionKey = null
                        encryptionOn = false
                        encryptEncrypted(true, key)
                    } else encryptionOn = false
                })
            }
            if (encryptionOn) {
                SettingsField(password, { if (it.length <= 35) password = it }, t("password"), Modifier.fillMaxWidth().padding(horizontal = 16.dp), password = true)
                SettingsField(passwordRepeat, { if (it.length <= 35) passwordRepeat = it }, t("encryption.repeatPassword"), Modifier.fillMaxWidth().padding(horizontal = 16.dp), password = true)
                if (password.isNotEmpty() && password != Session.encryptionKey && password == passwordRepeat) {
                    PrimaryButton(t("save"), Modifier.padding(16.dp)) {
                        Ui.confirm(t("encryptionConfirm"), t("save")) {
                            Ui.launch {
                                val sample = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Db.todos(ownWhere, arrayOf("1"), limit = 1).firstOrNull() }
                                if (sample != null && Crypto.decrypt(sample.text, password) == null) {
                                    Ui.error(t("passwordError"))
                                    return@launch
                                }
                                Session.encryptionKey = password
                                encryptEncrypted(false, password)
                                Ui.message(t("encryption.encryption"), t("encryption.encryptionSaved"))
                            }
                        }
                    }
                }
            }
            Divider()
            SectionHeader(t("count"))
            TableItem { TableText(t("encryptedTodos")); TableText("$encryptedCount") }
            TableItem { TableText(t("unencryptedTodos")); TableText("$unencryptedCount") }
            Divider()
            SectionHeader(t("general"))
            if (loading) Spinner()
            PrimaryButton(t("encryptAllButton"), Modifier.padding(horizontal = 16.dp, vertical = 8.dp), enabled = Session.encryptionKey != null && unencryptedCount > 0) {
                Ui.confirm(t("confirmEncryptAll"), t("encryptAllButton")) { changeEncrypted(true) }
            }
            PrimaryButton(t("decryptAllButton"), Modifier.padding(horizontal = 16.dp, vertical = 8.dp), enabled = Session.encryptionKey != null && encryptedCount > 0) {
                Ui.confirm(t("confirmDecryptAll"), t("decryptAllButton")) { changeEncrypted(false) }
            }
        }
    }
}

@Composable
fun DelegationUsersScreen(delegators: Boolean) {
    val me = Session.user?.id
    val users = dbState(delegators, initial = emptyList<com.todorant.data.DelegationUser>()) {
        (if (delegators) Db.delegators() else Db.delegates()).filter { it.serverId == null || it.serverId != me }
    }
    StackScreen(t(if (delegators) "delegate.delegators" else "delegate.delegates")) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 16.dp)) {
            if (users.isEmpty()) TableItem { TableText(t(if (delegators) "delegate.noDelegators" else "delegate.noDelegates")) }
            for (user in users) TableItem {
                TableText(user.name ?: user.delegateInviteToken ?: "", Modifier.weight(1f))
                IconBtn("delete_outline_28-iOS", Colors.destruct) {
                    Ui.confirm(t("delegate.deleteDelegatorConfirmation"), t("delete"), user.name) {
                        user.deleted = true
                        user.pending = true
                        user.updatedAt = System.currentTimeMillis()
                        Db.write { saveUser(user) }
                        Ui.launch { runCatching { Sync.sync(Sync.Kind.All) }.onFailure { Ui.error(it.message ?: "$it") } }
                    }
                }
            }
        }
    }
}
