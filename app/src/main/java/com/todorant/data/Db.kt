package com.todorant.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import java.security.SecureRandom

/** Sync status, same semantics as WatermelonDB's `_status` column. */
object Status {
    const val SYNCED = "synced"
    const val CREATED = "created"
    const val UPDATED = "updated"
}

data class Todo(
    var id: String = Db.newId(),
    var serverId: String? = null,
    var createdAt: Long = System.currentTimeMillis(),
    var updatedAt: Long = System.currentTimeMillis(),
    var text: String = "",
    var completed: Boolean = false,
    var frog: Boolean = false,
    var frogFails: Int = 0,
    var skipped: Boolean = false,
    var order: Double = 0.0,
    var monthAndYear: String? = null,
    var deleted: Boolean = false,
    var encrypted: Boolean = false,
    var date: String? = null,
    var time: String? = null,
    var repetitive: Boolean = false,
    var delegateAccepted: Boolean? = null,
    /** Server _id of the delegate (null for own todos) */
    var userId: String? = null,
    /** Server _id of the delegator (null for own todos) */
    var delegatorId: String? = null,
    var exactDate: Long? = null,
    var status: String = Status.CREATED,
) {
    /** Same as getTitle() in the RN app: "YYYY-MM" or "YYYY-MM-DD" */
    val title get() = "${monthAndYear ?: ""}${if (!date.isNullOrEmpty()) "-$date" else ""}"
    /** Server id if synced, else client id — used to identify todos across updates */
    val key get() = serverId ?: id

    /** Values as loaded from the database; local saves apply only the fields changed since */
    var base: Todo? = null
}

data class Tag(
    var id: String = Db.newId(),
    var serverId: String? = null,
    var createdAt: Long = System.currentTimeMillis(),
    var updatedAt: Long = System.currentTimeMillis(),
    var deleted: Boolean = false,
    var tag: String = "",
    var color: String? = null,
    var numberOfUses: Int = 0,
    var epic: Boolean? = null,
    var epicGoal: Int? = null,
    var epicCompleted: Boolean? = null,
    var epicPoints: Int? = null,
    var epicOrder: Int? = null,
    var status: String = Status.CREATED,
) {
    var base: Tag? = null
}

/** A delegate or a delegator. `pending` = local change that has to be pushed. */
data class DelegationUser(
    var id: String = Db.newId(),
    var serverId: String? = null,
    var name: String? = null,
    var isDelegator: Boolean = false,
    var deleted: Boolean = false,
    var delegateInviteToken: String? = null,
    var updatedAt: Long = System.currentTimeMillis(),
    var pending: Boolean = false,
)

object Db {
    private lateinit var helper: SQLiteOpenHelper
    val db: SQLiteDatabase get() = helper.writableDatabase

    /** Bumped after every write; UI re-queries when it changes. */
    val changes = MutableStateFlow(0L)

    private val random = SecureRandom()
    private const val ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

    /** 16 alphanumeric chars, the format the server validates client ids against */
    fun newId() = String(CharArray(16) { ALPHABET[random.nextInt(ALPHABET.length)] })

    fun init(context: Context) {
        helper = object : SQLiteOpenHelper(context, "todorant.db", null, 1) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE todos (id TEXT PRIMARY KEY, server_id TEXT, created_at INTEGER, updated_at INTEGER,
                    text TEXT, is_completed INTEGER, is_frog INTEGER, frog_fails INTEGER, is_skipped INTEGER, "order" REAL,
                    month_and_year TEXT, is_deleted INTEGER, is_encrypted INTEGER, date TEXT, time TEXT, is_repetitive INTEGER,
                    is_delegate_accepted INTEGER, user_id TEXT, delegator_id TEXT, exact_date_at INTEGER, _status TEXT)"""
                )
                db.execSQL("CREATE INDEX todos_server_id ON todos (server_id)")
                db.execSQL("CREATE INDEX todos_day ON todos (month_and_year, date)")
                db.execSQL(
                    """CREATE TABLE tags (id TEXT PRIMARY KEY, server_id TEXT, created_at INTEGER, updated_at INTEGER,
                    is_deleted INTEGER, tag TEXT, color TEXT, number_of_uses INTEGER, is_epic INTEGER, epic_goal INTEGER,
                    is_epic_completed INTEGER, epic_points INTEGER, epic_order INTEGER, _status TEXT)"""
                )
                db.execSQL(
                    """CREATE TABLE users (id TEXT PRIMARY KEY, server_id TEXT, name TEXT, is_delegator INTEGER,
                    is_deleted INTEGER, delegate_invite_token TEXT, updated_at INTEGER, pending INTEGER)"""
                )
            }

            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
        }
    }

    fun <T> write(block: SQLiteDatabase.() -> T): T {
        val d = db
        d.beginTransaction()
        try {
            val r = d.block()
            d.setTransactionSuccessful()
            return r
        } finally {
            d.endTransaction()
            changes.value++
        }
    }

    fun clear() = write {
        delete("todos", null, null)
        delete("tags", null, null)
        delete("users", null, null)
    }

    // region Todos

    const val UNDELETED = "is_deleted = 0"

    fun todos(where: String = "1", args: Array<String> = emptyArray(), orderBy: String? = null, limit: Int? = null): List<Todo> =
        db.query("todos", null, where, args, null, null, orderBy, limit?.toString()).use { c ->
            val list = ArrayList<Todo>(c.count)
            while (c.moveToNext()) list.add(c.toTodo())
            list
        }

    fun count(table: String, where: String, args: Array<String> = emptyArray()): Int =
        db.rawQuery("SELECT COUNT(*) FROM $table WHERE $where", args).use { it.moveToFirst(); it.getInt(0) }

    fun todo(idOrServerId: String?): Todo? = idOrServerId?.let {
        todos("id = ? OR server_id = ?", arrayOf(it, it)).firstOrNull()
    }

    private val todoFields = listOf(
        Todo::text, Todo::completed, Todo::frog, Todo::frogFails, Todo::skipped, Todo::order, Todo::monthAndYear,
        Todo::deleted, Todo::encrypted, Todo::date, Todo::time, Todo::repetitive, Todo::delegateAccepted,
        Todo::userId, Todo::delegatorId, Todo::exactDate,
    )
    private val tagFields = listOf(
        Tag::deleted, Tag::tag, Tag::color, Tag::numberOfUses, Tag::epic, Tag::epicGoal, Tag::epicCompleted,
        Tag::epicPoints, Tag::epicOrder,
    )

    /**
     * Like WatermelonDB's record.update: applies only the fields [mine] changed since it was loaded onto the
     * current row, so a sync that landed in between (server id, remote edits) isn't overwritten.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> merge(current: T, base: T, mine: T, fields: List<kotlin.reflect.KMutableProperty1<T, *>>): T {
        for (f in fields as List<kotlin.reflect.KMutableProperty1<T, Any?>>) {
            if (f.get(mine) != f.get(base)) f.set(current, f.get(mine))
        }
        return current
    }

    /** Local change: bumps updated_at and marks the todo for pushing. Call inside [write]. */
    fun SQLiteDatabase.saveTodo(todo: Todo, local: Boolean = true) {
        var row = todo
        if (local) {
            val base = todo.base
            val current = if (base != null) todos("id = ?", arrayOf(todo.id)).firstOrNull() else null
            if (base != null && current != null) row = merge(current, base, todo, todoFields)
            row.updatedAt = System.currentTimeMillis()
            if (row.status == Status.SYNCED) row.status = Status.UPDATED
        }
        insertWithOnConflict("todos", null, row.values(), SQLiteDatabase.CONFLICT_REPLACE)
        if (row !== todo) {
            todo.serverId = row.serverId; todo.status = row.status; todo.updatedAt = row.updatedAt
            todoFields.forEach { @Suppress("UNCHECKED_CAST") (it as kotlin.reflect.KMutableProperty1<Todo, Any?>).set(todo, it.get(row)) }
        }
        todo.base = todo.copy()
    }

    fun saveTodos(todos: Collection<Todo>) {
        if (todos.isEmpty()) return
        write { todos.forEach { saveTodo(it) } }
    }

    fun updateTodo(todo: Todo, change: (Todo) -> Unit) {
        change(todo)
        write { saveTodo(todo) }
    }

    private fun Todo.values() = ContentValues().apply {
        put("id", id); put("server_id", serverId); put("created_at", createdAt); put("updated_at", updatedAt)
        put("text", text); put("is_completed", completed); put("is_frog", frog); put("frog_fails", frogFails)
        put("is_skipped", skipped); put("\"order\"", order); put("month_and_year", monthAndYear); put("is_deleted", deleted)
        put("is_encrypted", encrypted); put("date", date); put("time", time); put("is_repetitive", repetitive)
        put("is_delegate_accepted", delegateAccepted); put("user_id", userId); put("delegator_id", delegatorId)
        put("exact_date_at", exactDate); put("_status", status)
    }

    private fun Cursor.toTodo() = Todo(
        id = str("id")!!, serverId = str("server_id"), createdAt = long("created_at") ?: 0, updatedAt = long("updated_at") ?: 0,
        text = str("text") ?: "", completed = bool("is_completed") == true, frog = bool("is_frog") == true,
        frogFails = long("frog_fails")?.toInt() ?: 0, skipped = bool("is_skipped") == true,
        order = getDouble(getColumnIndexOrThrow("order")), monthAndYear = str("month_and_year"),
        deleted = bool("is_deleted") == true, encrypted = bool("is_encrypted") == true, date = str("date"), time = str("time"),
        repetitive = bool("is_repetitive") == true, delegateAccepted = bool("is_delegate_accepted"),
        userId = str("user_id"), delegatorId = str("delegator_id"), exactDate = long("exact_date_at"), status = str("_status") ?: Status.SYNCED,
    ).also { it.base = it.copy() }

    // endregion

    // region Tags

    fun tags(where: String = "1", args: Array<String> = emptyArray(), orderBy: String? = null): List<Tag> =
        db.query("tags", null, where, args, null, null, orderBy).use { c ->
            val list = ArrayList<Tag>(c.count)
            while (c.moveToNext()) list.add(c.toTag())
            list
        }

    /** Same sort as TagStore.undeletedTags */
    fun undeletedTags(where: String = "1", args: Array<String> = emptyArray()) = tags(
        "is_deleted = 0 AND ($where)", args,
        "is_epic DESC, epic_order ASC, number_of_uses DESC, tag ASC"
    )

    fun epics() = undeletedTags("is_epic = 1")

    fun tag(idOrServerId: String?): Tag? = idOrServerId?.let {
        tags("id = ? OR server_id = ?", arrayOf(it, it)).firstOrNull()
    }

    fun SQLiteDatabase.saveTag(tag: Tag, local: Boolean = true) {
        var row = tag
        if (local) {
            val base = tag.base
            val current = if (base != null) tags("id = ?", arrayOf(tag.id)).firstOrNull() else null
            if (base != null && current != null) row = merge(current, base, tag, tagFields)
            row.updatedAt = System.currentTimeMillis()
            if (row.status == Status.SYNCED) row.status = Status.UPDATED
        }
        insertWithOnConflict("tags", null, row.values(), SQLiteDatabase.CONFLICT_REPLACE)
        if (row !== tag) {
            tag.serverId = row.serverId; tag.status = row.status; tag.updatedAt = row.updatedAt
            tagFields.forEach { @Suppress("UNCHECKED_CAST") (it as kotlin.reflect.KMutableProperty1<Tag, Any?>).set(tag, it.get(row)) }
        }
        tag.base = tag.copy()
    }

    fun updateTag(tag: Tag, change: (Tag) -> Unit) {
        change(tag)
        write { saveTag(tag) }
    }

    private fun Tag.values() = ContentValues().apply {
        put("id", id); put("server_id", serverId); put("created_at", createdAt); put("updated_at", updatedAt)
        put("is_deleted", deleted); put("tag", tag); put("color", color); put("number_of_uses", numberOfUses)
        put("is_epic", epic); put("epic_goal", epicGoal); put("is_epic_completed", epicCompleted)
        put("epic_points", epicPoints); put("epic_order", epicOrder); put("_status", status)
    }

    private fun Cursor.toTag() = Tag(
        id = str("id")!!, serverId = str("server_id"), createdAt = long("created_at") ?: 0, updatedAt = long("updated_at") ?: 0,
        deleted = bool("is_deleted") == true, tag = str("tag") ?: "", color = str("color"),
        numberOfUses = long("number_of_uses")?.toInt() ?: 0, epic = bool("is_epic"), epicGoal = long("epic_goal")?.toInt(),
        epicCompleted = bool("is_epic_completed"), epicPoints = long("epic_points")?.toInt(),
        epicOrder = long("epic_order")?.toInt(), status = str("_status") ?: Status.SYNCED,
    ).also { it.base = it.copy() }

    // endregion

    // region Users

    fun users(where: String = "1", args: Array<String> = emptyArray()): List<DelegationUser> =
        db.query("users", null, where, args, null, null, "name COLLATE NOCASE").use { c ->
            val list = ArrayList<DelegationUser>(c.count)
            while (c.moveToNext()) list.add(
                DelegationUser(
                    id = c.str("id")!!, serverId = c.str("server_id"), name = c.str("name"),
                    isDelegator = c.bool("is_delegator") == true, deleted = c.bool("is_deleted") == true,
                    delegateInviteToken = c.str("delegate_invite_token"), updatedAt = c.long("updated_at") ?: 0,
                    pending = c.bool("pending") == true,
                )
            )
            list
        }

    fun delegates() = users("is_delegator = 0 AND is_deleted = 0")
    fun delegators() = users("is_delegator = 1 AND is_deleted = 0")

    fun SQLiteDatabase.saveUser(user: DelegationUser) {
        insertWithOnConflict("users", null, ContentValues().apply {
            put("id", user.id); put("server_id", user.serverId); put("name", user.name); put("is_delegator", user.isDelegator)
            put("is_deleted", user.deleted); put("delegate_invite_token", user.delegateInviteToken)
            put("updated_at", user.updatedAt); put("pending", user.pending)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    // endregion

    private fun Cursor.str(col: String): String? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getString(it) }
    private fun Cursor.long(col: String): Long? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getLong(it) }
    private fun Cursor.bool(col: String): Boolean? = long(col)?.let { it != 0L }
}
