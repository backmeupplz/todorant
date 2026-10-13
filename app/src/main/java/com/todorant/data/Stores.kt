package com.todorant.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
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
class Pref<T>(private val key: String, private val default: T, private val decode: (String) -> T) : ReadWriteProperty<Any?, T> {
    private val state by lazy { mutableStateOf(Prefs.sp.getString(key, null)?.let(decode) ?: default) }
    override fun getValue(thisRef: Any?, property: KProperty<*>): T = state.value
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        state.value = value
        Prefs.sp.edit { if (value == null) remove(key) else putString(key, value.toString()) }
    }
}

fun boolPref(key: String, default: Boolean) = Pref(key, default) { it.toBoolean() }
fun optBoolPref(key: String) = Pref<Boolean?>(key, null) { it.toBoolean() }
fun intPref(key: String, default: Int) = Pref(key, default) { it.toInt() }
fun optIntPref(key: String) = Pref<Int?>(key, null) { it.toIntOrNull() }
fun optLongPref(key: String) = Pref<Long?>(key, null) { it.toLongOrNull() }
fun optStringPref(key: String) = Pref<String?>(key, null) { it }

fun isoToMillis(value: Any?): Long? = when (value) {
    is Number -> value.toLong()
    is String -> runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    else -> null
}

fun millisToIso(value: Long?): Any = value?.let { Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL

/** The server's user object; extra fields are kept in [json] so pushes don't drop them. */
class User(val json: JSONObject) {
    val id: String? get() = json.optString("_id").ifEmpty { null }
    val token: String get() = json.optString("token")
    val name: String get() = json.optString("name")
    val email: String? get() = json.optString("email").ifEmpty { null }
    val facebookId: String? get() = json.optString("facebookId").ifEmpty { null }
    val telegramId: String? get() = json.optString("telegramId").ifEmpty { null }
    val appleSubId: String? get() = json.optString("appleSubId").ifEmpty { null }
    val delegateInviteToken: String? get() = json.optString("delegateInviteToken").ifEmpty { null }
    val updatedAt: Long? get() = isoToMillis(json.opt("updatedAt"))
    val timezone: Any? get() = json.opt("timezone")

    fun with(change: JSONObject.() -> Unit) = User(JSONObject(json.toString()).apply(change))

    /** areUsersPartiallyEqual() from the RN app */
    fun partiallyEquals(other: User) = id == other.id && email == other.email && facebookId == other.facebookId &&
        telegramId == other.telegramId && name == other.name && timezone?.toString() == other.timezone?.toString()
}

object Session {
    var userJson by optStringPref("user")
    val user: User? get() = userJson?.let { User(JSONObject(it)) }
    fun setUser(user: User?) { userJson = user?.json?.toString() }

    var encryptionKey by optStringPref("encryptionKey")
    var numberOfTodosCompleted by intPref("numberOfTodosCompleted", 0)
    var askedToRate by boolPref("askedToRate", false)
    var installationId by optStringPref("installationId")

    var loggingOut by mutableStateOf(false)
    var isInitialSync by mutableStateOf(false)

    val needsToRequestRate get() = !askedToRate && numberOfTodosCompleted > 101
    val delegateInviteLink get() = "https://todorant.com/invite/${user?.delegateInviteToken}"

    fun init() {
        if (installationId == null) installationId = UUID.randomUUID().toString()
    }
}

enum class ColorMode { auto, dark, light }

object Settings {
    // Synced with the server
    var updatedAt by optLongPref("settings.updatedAt")
    var showTodayOnAddTodo by optBoolPref("showTodayOnAddTodo")
    var firstDayOfWeek by optIntPref("firstDayOfWeek")
    var startTimeOfDay by optStringPref("startTimeOfDay")
    var newTodosGoFirst by optBoolPref("newTodosGoFirst")
    var preserveOrderByTime by optBoolPref("preserveOrderByTime")
    var duplicateTagInBreakdown by optBoolPref("duplicateTagInBreakdown")
    var showMoreByDefault by optBoolPref("showMoreByDefault")
    var removeCompletedFromCalendar by optBoolPref("removeCompletedFromCalendar")
    var language by optStringPref("language")
    /** JSON object string */
    var googleCalendarCredentials by optStringPref("googleCalendarCredentials")

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

    fun toJson() = JSONObject().apply {
        put("showTodayOnAddTodo", showTodayOnAddTodo ?: JSONObject.NULL)
        put("firstDayOfWeek", firstDayOfWeek ?: JSONObject.NULL)
        put("startTimeOfDay", startTimeOfDay ?: JSONObject.NULL)
        put("newTodosGoFirst", newTodosGoFirst ?: JSONObject.NULL)
        put("preserveOrderByTime", preserveOrderByTime ?: JSONObject.NULL)
        put("duplicateTagInBreakdown", duplicateTagInBreakdown ?: JSONObject.NULL)
        put("showMoreByDefault", showMoreByDefault ?: JSONObject.NULL)
        put("language", language ?: JSONObject.NULL)
        put("removeCompletedFromCalendar", removeCompletedFromCalendar ?: JSONObject.NULL)
        // undefined in the RN app drops the key, which the server reads as "disconnect calendar"
        googleCalendarCredentials?.let { put("googleCalendarCredentials", JSONObject(it)) }
    }

    fun fromJson(s: JSONObject) {
        fun optBool(k: String) = if (s.isNull(k)) null else s.optBoolean(k)
        showTodayOnAddTodo = optBool("showTodayOnAddTodo")
        firstDayOfWeek = if (s.isNull("firstDayOfWeek")) null else s.optInt("firstDayOfWeek")
        startTimeOfDay = if (s.isNull("startTimeOfDay")) null else s.optString("startTimeOfDay")
        newTodosGoFirst = optBool("newTodosGoFirst")
        preserveOrderByTime = optBool("preserveOrderByTime")
        duplicateTagInBreakdown = optBool("duplicateTagInBreakdown")
        showMoreByDefault = optBool("showMoreByDefault")
        language = if (s.isNull("language")) null else s.optString("language")
        removeCompletedFromCalendar = optBool("removeCompletedFromCalendar")
        googleCalendarCredentials = s.optJSONObject("googleCalendarCredentials")?.toString()
        updatedAt = isoToMillis(s.opt("updatedAt"))
    }

    fun logout() {
        showTodayOnAddTodo = null; firstDayOfWeek = null; startTimeOfDay = null; newTodosGoFirst = null
        preserveOrderByTime = null; duplicateTagInBreakdown = null; showMoreByDefault = null; language = null
        removeCompletedFromCalendar = null; googleCalendarCredentials = null; updatedAt = null
        soundOn = true; endOfDaySoundOn = false
    }

    /** Marks a synced setting as changed locally */
    fun touch() { updatedAt = System.currentTimeMillis() }
}

object Hero {
    val ranks = listOf(0, 5, 13, 42, 69, 85, 100, 221, 256, 300, 404, 777, 800, 1337, 1338, 2048, 9000, 12800, 1000000)

    var points by intPref("hero.points", 0)
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

    fun logout() { updatedAt = null; points = 0 }
}

object Delegation {
    /** Last completed delegation sync */
    var updatedAt by optLongPref("delegation.updatedAt")
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
