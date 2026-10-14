package com.todorant.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

object Prefs {
    lateinit var sp: SharedPreferences
    fun init(context: Context) {
        sp = context.getSharedPreferences("todorant", Context.MODE_PRIVATE)
    }
}

/** Compose-observable value persisted in SharedPreferences. null removes the key. */
open class Pref<T>(private val key: String, private val default: T, private val decode: (String) -> T) : ReadWriteProperty<Any?, T> {
    private val state by lazy { mutableStateOf(Prefs.sp.getString(key, null)?.let(decode) ?: default) }
    override fun getValue(thisRef: Any?, property: KProperty<*>): T = state.value
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) = store(value)

    protected fun store(value: T) {
        state.value = value
        Prefs.sp.edit { if (value == null) remove(key) else putString(key, value.toString()) }
    }

    protected val current get() = state.value
    fun reset() = store(default)
}

fun boolPref(key: String, default: Boolean) = Pref(key, default) { it.toBoolean() }
fun intPref(key: String, default: Int) = Pref(key, default) { it.toInt() }
fun optLongPref(key: String) = Pref<Long?>(key, null) { it.toLongOrNull() }
fun optStringPref(key: String) = Pref<String?>(key, null) { it }

/**
 * A preference the server syncs (settings, hero points, name). Setting it queues the change like any
 * todo edit; [apply] takes a server value unless a local change of it is still waiting to be pushed.
 */
class SyncedPref<T>(
    private val collection: String,
    private val field: String,
    default: T,
    private val toWire: (T) -> Any? = { it },
    decode: (String) -> T,
    private val fromWire: (Any?) -> T,
) : Pref<T>("$collection.$field", default, decode) {
    init { all.add(this) }

    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        if (value == current) return
        store(value)
        Db.write { Db.enqueue(Change(collection, "", field, toWire(value), Db.now())) }
        Db.onLocalChange()
    }

    fun apply(json: JSONObject) {
        if (!json.has(field) || field in Db.pendingFields(collection, "")) return
        store(fromWire(if (json.isNull(field)) null else json.get(field)))
    }

    companion object {
        val all = mutableListOf<SyncedPref<*>>()
        fun apply(collection: String, json: JSONObject) = all.filter { it.collection == collection }.forEach { it.apply(json) }
        fun resetAll() = all.forEach { it.reset() }
    }
}

private fun syncedBool(field: String) = SyncedPref<Boolean?>("settings", field, null, decode = { it.toBoolean() }, fromWire = { it as? Boolean })
private fun syncedInt(field: String) = SyncedPref<Int?>("settings", field, null, decode = { it.toIntOrNull() }, fromWire = { (it as? Number)?.toInt() })
private fun syncedString(field: String) = SyncedPref<String?>("settings", field, null, decode = { it }, fromWire = { it as? String })

fun isoToMillis(value: Any?): Long? = when (value) {
    is Number -> value.toLong()
    is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    else -> null
}

/** The user's profile from the server plus the login token */
class User(val json: JSONObject) {
    val id: String? get() = json.optString("_id").ifEmpty { json.optString("id") }.ifEmpty { null }
    val token: String get() = json.optString("token")
    val name: String get() = json.optString("name")
    val email: String? get() = json.optString("email").ifEmpty { null }
    val facebookId: String? get() = json.optString("facebookId").ifEmpty { null }
    val telegramId: String? get() = json.optString("telegramId").ifEmpty { null }
    val appleSubId: String? get() = json.optString("appleSubId").ifEmpty { null }
    /** Email of an email + password account */
    val passwordLogin: String? get() = json.optString("passwordLogin").ifEmpty { null }
    val delegateInviteToken: String? get() = json.optString("delegateInviteToken").ifEmpty { null }
    val updatedAt: Long? get() = json.optLong("updatedAt").takeIf { it > 0 }

    fun with(change: JSONObject.() -> Unit) = User(JSONObject(json.toString()).apply(change))
}

object Session {
    var userJson by optStringPref("user")
    val user: User? get() = userJson?.let { User(JSONObject(it)) }
    fun setUser(user: User?) { userJson = user?.json?.toString() }

    var encryptionKey by optStringPref("encryptionKey")
    var numberOfTodosCompleted by intPref("numberOfTodosCompleted", 0)
    var askedToRate by boolPref("askedToRate", false)
    var installationId by optStringPref("installationId")

    /** The user's name, synced (the rest of the profile is read-only) */
    var name by SyncedPref("user", "name", "", decode = { it }, fromWire = { it as? String ?: "" })

    var loggingOut by mutableStateOf(false)
    var isInitialSync by mutableStateOf(false)

    val needsToRequestRate get() = !askedToRate && numberOfTodosCompleted > 101
    val delegateInviteLink get() = "https://todorant.com/invite/${user?.delegateInviteToken}"

    fun init() {
        if (installationId == null) installationId = UUID.randomUUID().toString()
    }

    /** Server profile (keeps the token) */
    fun applyProfile(profile: JSONObject) {
        val token = user?.token ?: return
        setUser(User(JSONObject(profile.toString()).put("token", token)))
        SyncedPref.apply("user", profile)
        profile.optJSONObject("settings")?.let { Settings.applyServer(it) }
    }
}

enum class ColorMode { auto, dark, light }

object Settings {
    // Synced with the server, field by field
    var showTodayOnAddTodo by syncedBool("showTodayOnAddTodo")
    var firstDayOfWeek by syncedInt("firstDayOfWeek")
    var startTimeOfDay by syncedString("startTimeOfDay")
    var newTodosGoFirst by syncedBool("newTodosGoFirst")
    var preserveOrderByTime by syncedBool("preserveOrderByTime")
    var duplicateTagInBreakdown by syncedBool("duplicateTagInBreakdown")
    var showMoreByDefault by syncedBool("showMoreByDefault")
    var language by syncedString("language")
    /** When the server last changed settings */
    var updatedAt by optLongPref("settings.updatedAt")

    // Local only
    var colorMode by Pref("colorMode", ColorMode.auto) { ColorMode.valueOf(it) }
    var askBeforeDelete by boolPref("askBeforeDelete", true)
    var soundOn by boolPref("soundOn", true)
    var endOfDaySoundOn by boolPref("endOfDaySoundOn", false)
    var gamificationOn by boolPref("gamificationOn", true)
    var badgeIconCurrentCount by boolPref("badgeIconCurrentCount", false)
    var planningReminderTime by optStringPref("planningReminderTime")
    var swipeActions by boolPref("swipeActions", true)
    /** "auto" or a language code picked by the user */
    var languageSelect by optStringPref("languageSelect")

    /** Updated by the activity from the system configuration */
    var systemDark by mutableStateOf(false)
    val isDark get() = if (colorMode == ColorMode.auto) systemDark else colorMode == ColorMode.dark

    val firstDayOfWeekSafe get() = firstDayOfWeek ?: if (language == "en") 0 else 1
    val startTimeOfDaySafe get() = startTimeOfDay ?: "00:00"

    fun applyServer(settings: JSONObject) {
        val before = language
        SyncedPref.apply("settings", settings)
        updatedAt = isoToMillis(settings.opt("updatedAt"))
        // A language picked on another device sticks after restarts too
        language?.takeIf { it != before }?.let { languageSelect = it }
    }

    fun logout() {
        updatedAt = null
        soundOn = true
        endOfDaySoundOn = false
    }
}

object Hero {
    val ranks = listOf(0, 5, 13, 42, 69, 85, 100, 221, 256, 300, 404, 777, 800, 1337, 1338, 2048, 9000, 12800, 1000000)

    /** Synced; the server keeps the highest value any device reports */
    var points by SyncedPref("hero", "points", 0, decode = { it.toInt() }, fromWire = { (it as? Number)?.toInt() ?: 0 })
    var updatedAt by optLongPref("hero.updatedAt")

    private fun bracket(): Pair<Int, Int>? {
        var prev = 0
        for (r in ranks) {
            if (points in prev until r) return prev to r
            prev = r
        }
        return null
    }

    val rank get() = bracket()?.first ?: -1
    val nextRank get() = bracket()?.second ?: -1
    val rankIndex get() = bracket()?.let { ranks.indexOf(it.second) - 1 } ?: -1
    val progress get() = (points - rank).toFloat() / (nextRank - rank)
}

/** Invite links accepted while offline, retried on the next connection */
object Invites {
    private var pending by optStringPref("invites.pending")
    val all: List<String> get() = pending?.let { p -> JSONArray(p).let { a -> (0 until a.length()).map(a::getString) } } ?: emptyList()
    fun add(token: String) { if (token !in all) pending = JSONArray(all + token).toString() }
    fun remove(token: String) { pending = JSONArray(all - token).toString() }
}

enum class TodoSection { planning, completed }
enum class DelegateSection { ToMe, ByMe, Completed }

/** Non-persisted UI state shared between screens (AppStateStore in the RN app) */
object AppState {
    var todoSection by mutableStateOf(TodoSection.planning)
    val hash = mutableStateListOf<String>()
    var searchEnabled by mutableStateOf(false)
    var searchQuery by mutableStateOf("")
    var calendarEnabled by mutableStateOf(false)
    var delegateSection by mutableStateOf(DelegateSection.ToMe)
}
