package com.todorant.logic

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.core.content.edit
import com.todorant.data.Db
import com.todorant.data.Db.saveTag
import com.todorant.data.Db.saveTodo
import com.todorant.data.Db.saveUser
import com.todorant.data.DelegationUser
import com.todorant.data.Prefs
import com.todorant.data.Session
import com.todorant.data.ColorMode
import com.todorant.data.Hero
import com.todorant.data.Settings
import com.todorant.data.User
import com.todorant.data.isoToMillis
import org.json.JSONObject
import java.io.File
import com.todorant.data.Status
import com.todorant.data.Tag
import com.todorant.data.Todo
import com.todorant.sync.Rest
import com.todorant.ui.Onboarding
import com.todorant.ui.Ui

/**
 * One-time upgrade from the React Native app installed under the same package:
 * - the login token and encryption password it shared with its widget through SharedPreferences
 * - todos and tags in its WatermelonDB that never reached the server (anonymous users have only those)
 */
object Migration {
    private const val TAG = "Migration"

    fun run(context: Context) {
        if (Prefs.sp.getBoolean("rnMigrationDone", false)) return
        Prefs.sp.edit { putBoolean("rnMigrationDone", true) }
        val old = context.getSharedPreferences("wit_player_shared_preferences", Context.MODE_PRIVATE)
        val stores = runCatching { readMmkv(File(context.filesDir, "mmkv/default")) }.onFailure { Log.w(TAG, "MMKV", it) }.getOrDefault(emptyMap())
        val oldUser = stores["SessionStore"]?.optJSONObject("user")
        var token = oldUser?.optString("token")?.takeIf { it.isNotBlank() } ?: old.getString("token", null)?.takeIf { it.isNotBlank() }
        old.getString("password", null)?.takeIf { it.isNotBlank() }?.let { Session.encryptionKey = it }
        runCatching { importStores(stores) }.onFailure { Log.w(TAG, "stores", it) }
        val imported = runCatching { importWatermelon(context) }.onFailure { Log.w(TAG, "WatermelonDB import", it) }.getOrDefault(0)
        if (token != null || imported > 0) Onboarding.tutorialIsShown = true
        if (stores["OnboardingStore"]?.optBoolean("tutorialIsShown") == true) Onboarding.tutorialIsShown = true
        if (token != null && Session.user == null) Ui.launch {
            // The stored user works offline right away; the token login refreshes it
            val user = oldUser?.takeIf { it.optString("token") == token }?.let(::User) ?: runCatching { Rest.loginToken(token!!) }
                .onFailure { Log.w(TAG, "token login", it) }.getOrNull()
            user?.let { runCatching { Account.login(it) }.onFailure { e -> Log.w(TAG, "login", e) } }
        }
    }

    /** Local-only settings, counters and hero points from the RN stores (synced ones get reconciled by updatedAt) */
    private fun importStores(stores: Map<String, JSONObject>) {
        stores["SettingsStore"]?.let { s ->
            fun b(k: String) = if (s.has(k) && !s.isNull(k)) s.optBoolean(k) else null
            b("askBeforeDelete")?.let { Settings.askBeforeDelete = it }
            b("soundOn")?.let { Settings.soundOn = it }
            b("endOfDaySoundOn")?.let { Settings.endOfDaySoundOn = it }
            b("gamificationOn")?.let { Settings.gamificationOn = it }
            b("badgeIconCurrentCount")?.let { Settings.badgeIconCurrentCount = it }
            b("swipeActions")?.let { Settings.swipeActions = it }
            s.optString("colorMode").takeIf { it.isNotEmpty() }?.let { m -> runCatching { Settings.colorMode = ColorMode.valueOf(m) } }
            s.optString("planningReminderTime").takeIf { it.isNotEmpty() }?.let { Settings.planningReminderTime = it }
            if (s.has("updatedAt") && !s.isNull("updatedAt")) Settings.fromJson(s)
        }
        stores["SessionStore"]?.let { s ->
            s.optString("encryptionKey").takeIf { it.isNotEmpty() }?.let { Session.encryptionKey = it }
            Session.numberOfTodosCompleted = s.optInt("numberOfTodosCompleted", Session.numberOfTodosCompleted)
            Session.askedToRate = s.optBoolean("askedToRate", Session.askedToRate)
        }
        stores["HeroStore"]?.let { h ->
            Hero.points = h.optInt("points", Hero.points)
            Hero.updatedAt = isoToMillis(h.opt("updatedAt"))
        }
        stores["languageSelect"]?.optString("value")?.takeIf { it.isNotEmpty() }?.let { Settings.languageSelect = it }
    }

    /**
     * MMKV's file is an append-only log of [varint key length][key][varint value length][value]; string values are
     * length-prefixed again. We only need a few keys, so find each key's last occurrence and read the string after it.
     */
    internal fun readMmkv(file: File): Map<String, JSONObject> {
        if (!file.exists()) return emptyMap()
        val bytes = file.readBytes()
        val result = HashMap<String, JSONObject>()
        for (key in listOf("SettingsStore", "SessionStore", "HeroStore", "OnboardingStore", "languageSelect")) {
            val k = key.toByteArray()
            var at = -1
            var i = 0
            while (i <= bytes.size - k.size) {
                if (bytes[i] == k[0] && (k.indices).all { bytes[i + it] == k[it] }) at = i
                i++
            }
            if (at < 0) continue
            var pos = at + k.size
            fun varint(): Int {
                var shift = 0; var value = 0
                while (pos < bytes.size) {
                    val b = bytes[pos++].toInt()
                    value = value or ((b and 0x7f) shl shift)
                    if (b and 0x80 == 0) break
                    shift += 7
                }
                return value
            }
            varint() // value length
            val length = varint() // string length
            if (length <= 0 || pos + length > bytes.size) continue
            val text = String(bytes, pos, length, Charsets.UTF_8)
            result[key] = runCatching { JSONObject(text) }.getOrElse { JSONObject().put("value", text) }
        }
        return result
    }

    /** Imports unsynced records; returns > 0 when the old app had any todos */
    private fun importWatermelon(context: Context): Int {
        val file = context.getDatabasePath("watermelon.db")
        if (!file.exists()) return 0
        val old = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
        return old.use { db ->
            val anyTodos = db.rawQuery("SELECT COUNT(*) FROM todos", null).use { it.moveToFirst(); it.getInt(0) } > 0
            val serverIds = HashMap<String, String>()
            db.rawQuery("SELECT id, server_id FROM users", null).use { c ->
                while (c.moveToNext()) c.getString(1)?.let { serverIds[c.getString(0)] = it }
            }
            val todos = db.rawQuery("SELECT * FROM todos WHERE _status != 'synced'", null).use { c ->
                generateSequence { if (c.moveToNext()) c.oldTodo(serverIds) else null }.toList()
            }
            val tags = db.rawQuery("SELECT * FROM tags WHERE _status != 'synced'", null).use { c ->
                generateSequence { if (c.moveToNext()) c.oldTag() else null }.toList()
            }
            // Invites accepted offline that never reached the server
            val invites = db.rawQuery(
                "SELECT delegate_invite_token FROM users WHERE server_id IS NULL AND is_delegator = 1 AND delegate_invite_token IS NOT NULL", null
            ).use { c -> generateSequence { if (c.moveToNext()) c.getString(0) else null }.toList() }
            Db.write {
                todos.forEach { saveTodo(it, local = false) }
                tags.forEach { saveTag(it, local = false) }
                invites.forEach { saveUser(DelegationUser(isDelegator = true, delegateInviteToken = it, pending = true)) }
            }
            Log.i(TAG, "imported ${todos.size} todos, ${tags.size} tags")
            todos.size + tags.size + if (anyTodos) 1 else 0
        }
    }

    private fun Cursor.str(col: String): String? = getColumnIndex(col).takeIf { it >= 0 && !isNull(it) }?.let { getString(it) }
    private fun Cursor.num(col: String): Double? = getColumnIndex(col).takeIf { it >= 0 && !isNull(it) }?.let { getDouble(it) }
    private fun Cursor.flag(col: String): Boolean? = num(col)?.let { it != 0.0 }
    private fun Cursor.status() = if (str("_status") == "created") Status.CREATED else Status.UPDATED

    private fun Cursor.oldTodo(serverIds: Map<String, String>) = Todo(
        id = str("id")!!, serverId = str("server_id"), createdAt = num("created_at")?.toLong() ?: 0,
        updatedAt = num("updated_at")?.toLong() ?: 0, text = str("text") ?: "", completed = flag("is_completed") == true,
        frog = flag("is_frog") == true, frogFails = num("frog_fails")?.toInt() ?: 0, skipped = flag("is_skipped") == true,
        order = num("order") ?: 0.0, monthAndYear = str("month_and_year"), deleted = flag("is_deleted") == true,
        encrypted = flag("is_encrypted") == true, date = str("date"), time = str("time"), repetitive = flag("is_repetitive") == true,
        delegateAccepted = flag("is_delegate_accepted"),
        // WatermelonDB referenced local user rows; this app references server ids
        userId = str("delegator_id")?.let { str("user_id")?.let(serverIds::get) },
        delegatorId = str("delegator_id")?.let(serverIds::get),
        status = status(),
    ).also { it.exactDate = exactDate(it.title) }

    private fun Cursor.oldTag() = Tag(
        id = str("id")!!, serverId = str("server_id"), createdAt = num("created_at")?.toLong() ?: 0,
        updatedAt = num("updated_at")?.toLong() ?: 0, deleted = flag("is_deleted") == true, tag = str("tag") ?: "",
        color = str("color"), numberOfUses = num("number_of_uses")?.toInt() ?: 0, epic = flag("is_epic"),
        epicGoal = num("epic_goal")?.toInt(), epicCompleted = flag("is_epic_completed"), epicPoints = num("epic_points")?.toInt(),
        epicOrder = num("epic_order")?.toInt(), status = status(),
    )
}
