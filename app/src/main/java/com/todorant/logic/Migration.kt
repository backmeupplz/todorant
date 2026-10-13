package com.todorant.logic

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.core.content.edit
import com.todorant.data.Db
import com.todorant.data.Db.saveTag
import com.todorant.data.Db.saveTodo
import com.todorant.data.Prefs
import com.todorant.data.Session
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
        val token = old.getString("token", null)?.takeIf { it.isNotBlank() }
        old.getString("password", null)?.takeIf { it.isNotBlank() }?.let { Session.encryptionKey = it }
        val imported = runCatching { importWatermelon(context) }.onFailure { Log.w(TAG, "WatermelonDB import", it) }.getOrDefault(0)
        if (token != null || imported > 0) Onboarding.tutorialIsShown = true
        if (token != null && Session.user == null) Ui.launch {
            runCatching { Account.login(Rest.loginToken(token)) }.onFailure { Log.w(TAG, "token login", it) }
        }
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
            Db.write {
                todos.forEach { saveTodo(it, local = false) }
                tags.forEach { saveTag(it, local = false) }
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
