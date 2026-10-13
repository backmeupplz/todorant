package com.todorant.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.todorant.logic.exactDate
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger
import kotlin.reflect.KMutableProperty1

/** Mongo ObjectIds made on the device: the server stores todos under the ids clients give them */
object Ids {
    private val random = SecureRandom()
    private val machine = ByteArray(5).also { random.nextBytes(it) }
    private val counter = AtomicInteger(random.nextInt())

    fun new(): String {
        val bytes = ByteArray(12)
        val seconds = (System.currentTimeMillis() / 1000).toInt()
        for (i in 0..3) bytes[i] = (seconds shr (24 - 8 * i)).toByte()
        machine.copyInto(bytes, 4)
        val count = counter.incrementAndGet()
        for (i in 0..2) bytes[9 + i] = (count shr (16 - 8 * i)).toByte()
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

/** A synced document. [base] holds the values it was loaded with, to know what a save changed. */
interface Doc {
    val id: String
    var base: Doc?
}

data class Todo(
    override var id: String = Ids.new(),
    var text: String = "",
    var completed: Boolean = false,
    var frog: Boolean = false,
    var frogFails: Int = 0,
    var skipped: Boolean = false,
    var order: Double = 0.0,
    var monthAndYear: String? = null,
    var date: String? = null,
    var time: String? = null,
    var deleted: Boolean = false,
    var encrypted: Boolean = false,
    var repetitive: Boolean = false,
    var delegateAccepted: Boolean? = null,
    /** Server id of the owner (the delegate for delegated todos) */
    var userId: String? = null,
    /** Server id of the delegator, null for own todos */
    var delegatorId: String? = null,
    var createdAt: Long = System.currentTimeMillis(),
    var updatedAt: Long = 0,
    /** Local only: UTC midnight of the day (or month), for sorting */
    var exactDate: Long? = null,
) : Doc {
    override var base: Doc? = null

    /** getTitle() from the RN app: "YYYY-MM" or "YYYY-MM-DD" */
    val title get() = "${monthAndYear ?: ""}${if (!date.isNullOrEmpty()) "-$date" else ""}"
}

data class Tag(
    override var id: String = Ids.new(),
    var tag: String = "",
    var color: String? = null,
    var deleted: Boolean = false,
    var epic: Boolean = false,
    var epicCompleted: Boolean = false,
    var epicGoal: Int = 0,
    var epicPoints: Int = 0,
    var epicOrder: Int = 0,
    var numberOfUses: Int = 0,
    var createdAt: Long = System.currentTimeMillis(),
    var updatedAt: Long = 0,
) : Doc {
    override var base: Doc? = null
}

/** A delegate or a delegator (from the server's delegation snapshot) */
data class DelegationUser(val id: String, val name: String?, val isDelegator: Boolean)

enum class Kind { TEXT, INT, LONG, REAL, BOOL }

/** A column. [synced] fields travel to the server; column and wire names are the same. */
class Field<T>(val name: String, val kind: Kind, property: KMutableProperty1<T, *>, val synced: Boolean = true) {
    @Suppress("UNCHECKED_CAST")
    private val prop = property as KMutableProperty1<T, Any?>
    fun get(doc: T): Any? = prop.get(doc)
    fun set(doc: T, value: Any?) = prop.set(doc, value)

    fun read(c: Cursor, index: Int): Any? = if (c.isNull(index)) null else when (kind) {
        Kind.TEXT -> c.getString(index)
        Kind.INT -> c.getInt(index)
        Kind.LONG -> c.getLong(index)
        Kind.REAL -> c.getDouble(index)
        Kind.BOOL -> c.getInt(index) != 0
    }

    /** Quoted: some column names ("order") are SQL keywords */
    private val column = "\"$name\""

    fun put(values: ContentValues, doc: T) = when (val v = get(doc)) {
        null -> values.putNull(column)
        is String -> values.put(column, v)
        is Int -> values.put(column, v)
        is Long -> values.put(column, v)
        is Double -> values.put(column, v)
        is Boolean -> values.put(column, v)
        else -> error("Unsupported $name")
    }

    fun fromJson(json: JSONObject): Any? = if (json.isNull(name)) null else when (kind) {
        Kind.TEXT -> json.getString(name)
        Kind.INT -> json.getDouble(name).toInt()
        Kind.LONG -> json.getLong(name)
        Kind.REAL -> json.getDouble(name)
        Kind.BOOL -> json.getBoolean(name)
    }
}

/** Everything about a collection, defined once: table, wire name, columns, defaults */
abstract class Entity<T : Doc>(val table: String, val collection: String, private val factory: () -> T) {
    abstract val fields: List<Field<T>>
    val synced by lazy { fields.filter { it.synced } }
    private val defaults by lazy { factory().let { d -> fields.associate { it.name to it.get(d) } } }

    fun new() = factory()
    fun copy(doc: T): T = factory().also { copy -> fields.forEach { it.set(copy, it.get(doc)) } }

    /** Local-only columns derived from synced ones */
    open fun prepare(doc: T) {}

    /** Server value or null → the property (nulls become defaults for non-null properties) */
    fun assign(doc: T, field: Field<T>, value: Any?) = field.set(doc, value ?: defaults[field.name])

    fun createSql() = "CREATE TABLE $table (" + fields.joinToString(", ") {
        "\"${it.name}\" " + (if (it.name == "id") "TEXT PRIMARY KEY" else when (it.kind) {
            Kind.TEXT -> "TEXT"; Kind.REAL -> "REAL"; else -> "INTEGER"
        })
    } + ")"

    fun read(c: Cursor): T = factory().also { doc ->
        fields.forEachIndexed { i, field -> assign(doc, field, field.read(c, i)) }
        doc.base = copy(doc)
    }

    fun values(doc: T) = ContentValues().also { values -> fields.forEach { it.put(values, doc) } }

    /** Every column as JSON (exports, debugging) */
    fun toJson(doc: T) = JSONObject().also { json -> fields.forEach { json.put(it.name, it.get(doc) ?: JSONObject.NULL) } }

    val columns by lazy { fields.map { "\"${it.name}\"" }.toTypedArray() }
}

object TodoEntity : Entity<Todo>("todos", "todo", ::Todo) {
    override val fields = listOf(
        Field("id", Kind.TEXT, Todo::id, synced = false),
        Field("text", Kind.TEXT, Todo::text),
        Field("completed", Kind.BOOL, Todo::completed),
        Field("frog", Kind.BOOL, Todo::frog),
        Field("frogFails", Kind.INT, Todo::frogFails),
        Field("skipped", Kind.BOOL, Todo::skipped),
        Field("order", Kind.REAL, Todo::order),
        Field("monthAndYear", Kind.TEXT, Todo::monthAndYear),
        Field("date", Kind.TEXT, Todo::date),
        Field("time", Kind.TEXT, Todo::time),
        Field("deleted", Kind.BOOL, Todo::deleted),
        Field("encrypted", Kind.BOOL, Todo::encrypted),
        Field("repetitive", Kind.BOOL, Todo::repetitive),
        Field("delegateAccepted", Kind.BOOL, Todo::delegateAccepted),
        // Ownership is set when a todo is created (delegation) and never changes after
        Field("user", Kind.TEXT, Todo::userId),
        Field("delegator", Kind.TEXT, Todo::delegatorId),
        Field("createdAt", Kind.LONG, Todo::createdAt, synced = false),
        Field("updatedAt", Kind.LONG, Todo::updatedAt, synced = false),
        Field("exactDate", Kind.LONG, Todo::exactDate, synced = false),
    )

    override fun prepare(doc: Todo) { doc.exactDate = exactDate(doc.title) }
}

object TagEntity : Entity<Tag>("tags", "tag", ::Tag) {
    override val fields = listOf(
        Field("id", Kind.TEXT, Tag::id, synced = false),
        Field("tag", Kind.TEXT, Tag::tag),
        Field("color", Kind.TEXT, Tag::color),
        Field("deleted", Kind.BOOL, Tag::deleted),
        Field("epic", Kind.BOOL, Tag::epic),
        Field("epicCompleted", Kind.BOOL, Tag::epicCompleted),
        Field("epicGoal", Kind.INT, Tag::epicGoal),
        Field("epicPoints", Kind.INT, Tag::epicPoints),
        Field("epicOrder", Kind.INT, Tag::epicOrder),
        Field("numberOfUses", Kind.INT, Tag::numberOfUses),
        Field("createdAt", Kind.LONG, Tag::createdAt, synced = false),
        Field("updatedAt", Kind.LONG, Tag::updatedAt, synced = false),
    )
}

/** A pending local change of one field, waiting to be pushed */
data class Change(val collection: String, val id: String, val field: String, val value: Any?, val at: Long)

object Db {
    private lateinit var helper: SQLiteOpenHelper
    val db: SQLiteDatabase get() = helper.writableDatabase

    /** Bumped after every write; UI re-queries when it changes */
    val changes = MutableStateFlow(0L)

    /** Called after local changes are queued (the sync engine pushes them) */
    var onLocalChange: () -> Unit = {}

    /** Server clock, so edit times are comparable across devices (set by the sync engine) */
    var now: () -> Long = System::currentTimeMillis

    fun init(context: Context) {
        helper = object : SQLiteOpenHelper(context, "todorant-v2.db", null, 1) {
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL(TodoEntity.createSql())
                db.execSQL("CREATE INDEX todos_day ON todos (monthAndYear, date)")
                db.execSQL("CREATE INDEX todos_list ON todos (deleted, completed, exactDate)")
                db.execSQL(TagEntity.createSql())
                db.execSQL("CREATE TABLE users (id TEXT, name TEXT, isDelegator INTEGER, PRIMARY KEY (id, isDelegator))")
                db.execSQL("CREATE TABLE outbox (c TEXT, id TEXT, field TEXT, value TEXT, at INTEGER, PRIMARY KEY (c, id, field))")
            }

            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
        }
    }

    fun <R> write(block: SQLiteDatabase.() -> R): R {
        val d = db
        d.beginTransaction()
        try {
            return d.block().also { d.setTransactionSuccessful() }
        } finally {
            d.endTransaction()
            changes.value++
        }
    }

    fun clear() = write { listOf("todos", "tags", "users", "outbox").forEach { delete(it, null, null) } }

    fun count(table: String, where: String, args: Array<String> = emptyArray()): Int =
        db.rawQuery("SELECT COUNT(*) FROM $table WHERE $where", args).use { it.moveToFirst(); it.getInt(0) }

    fun <T : Doc> query(entity: Entity<T>, where: String = "1", args: Array<String> = emptyArray(), orderBy: String? = null, limit: Int? = null): List<T> =
        db.query(entity.table, entity.columns, where, args, null, null, orderBy, limit?.toString()).use { c ->
            ArrayList<T>(c.count).also { list -> while (c.moveToNext()) list.add(entity.read(c)) }
        }

    fun <T : Doc> get(entity: Entity<T>, id: String?): T? = id?.let { query(entity, "id = ?", arrayOf(it)).firstOrNull() }

    /**
     * Saves local edits like WatermelonDB's record.update: only the fields changed since the doc was
     * loaded go onto the current row (a sync that landed meanwhile isn't overwritten), and each of them
     * is queued for the server with its edit time. New docs (no [Doc.base]) queue every synced field.
     */
    fun <T : Doc> save(entity: Entity<T>, docs: Collection<T>) {
        if (docs.isEmpty()) return
        val at = now()
        write {
            for (doc in docs) {
                @Suppress("UNCHECKED_CAST")
                val base = doc.base as T?
                val current = if (base != null) get(entity, doc.id) else null
                // New docs send everything that's set, edits only what changed
                val changed = entity.synced.filter { if (base == null) it.get(doc) != null else it.get(doc) != it.get(base) }.toMutableList()
                // A todo switching encryption has to send its text again
                if (entity === TodoEntity && changed.any { it.name == "encrypted" }) TodoEntity.synced.first { it.name == "text" }.let { if (it !in changed) changed.add(it) }
                val row = current ?: entity.copy(doc)
                for (field in changed) field.set(row, field.get(doc))
                entity.prepare(row)
                insertWithOnConflict(entity.table, null, entity.values(row), SQLiteDatabase.CONFLICT_REPLACE)
                for (field in changed) enqueue(Change(entity.collection, doc.id, field.name, field.get(row), at))
                entity.fields.forEach { it.set(doc, it.get(row)) }
                doc.base = entity.copy(row)
            }
        }
        onLocalChange()
    }

    fun <T : Doc> save(entity: Entity<T>, doc: T) = save(entity, listOf(doc))

    /** Queues every field of every document again, as if all were new (the Data screen's re-push) */
    fun <T : Doc> pushAgain(entity: Entity<T>) = save(entity, query(entity).onEach { it.base = null })

    /** Rewrites a row's local-only columns (no sync). Call inside [write]. */
    fun <T : Doc> writeLocal(entity: Entity<T>, doc: T) {
        entity.prepare(doc)
        db.insertWithOnConflict(entity.table, null, entity.values(doc), SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun <T : Doc> edit(entity: Entity<T>, doc: T, change: (T) -> Unit) {
        change(doc)
        save(entity, doc)
    }

    /**
     * Applies a server version of a document. Fields with local changes still waiting to be pushed keep
     * their local values (the server resolves them when they arrive). Call inside [write].
     */
    fun <T : Doc> applyRemote(entity: Entity<T>, json: JSONObject) {
        val id = json.optString("id").ifEmpty { return }
        val pending = pendingFields(entity.collection, id)
        val doc = get(entity, id) ?: entity.new().also { entity.fields.first { it.name == "id" }.set(it, id) }
        for (field in entity.fields) {
            if (field.name != "id" && json.has(field.name) && field.name !in pending) entity.assign(doc, field, field.fromJson(json))
        }
        entity.prepare(doc)
        db.insertWithOnConflict(entity.table, null, entity.values(doc), SQLiteDatabase.CONFLICT_REPLACE)
    }

    // region Outbox

    private fun encode(value: Any?) = JSONArray().put(value ?: JSONObject.NULL).toString()
    private fun decode(text: String): Any? = JSONArray(text).let { if (it.isNull(0)) null else it.get(0) }

    /** Queues a change; a newer change of the same field replaces the older one */
    fun enqueue(change: Change) {
        db.insertWithOnConflict("outbox", null, ContentValues().apply {
            put("c", change.collection); put("id", change.id); put("field", change.field)
            put("value", encode(change.value)); put("at", change.at)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun outbox(): List<Change> = db.rawQuery("SELECT c, id, field, value, at FROM outbox ORDER BY at", null).use { c ->
        ArrayList<Change>(c.count).also { list ->
            while (c.moveToNext()) list.add(Change(c.getString(0), c.getString(1), c.getString(2), decode(c.getString(3)), c.getLong(4)))
        }
    }

    fun pendingFields(collection: String, id: String): Set<String> =
        db.rawQuery("SELECT field FROM outbox WHERE c = ? AND id = ?", arrayOf(collection, id)).use { c ->
            HashSet<String>().also { while (c.moveToNext()) it.add(c.getString(0)) }
        }

    /** The server has these changes (or rejected them for good); newer edits of the same fields stay queued */
    fun acknowledge(sent: Collection<Change>) = db.apply {
        for (change in sent) execSQL("DELETE FROM outbox WHERE c = ? AND id = ? AND field = ? AND at <= ?", arrayOf<Any>(change.collection, change.id, change.field, change.at))
    }

    // endregion

    // region Typed helpers

    const val UNDELETED = "deleted = 0"

    fun todos(where: String = "1", args: Array<String> = emptyArray(), orderBy: String? = null, limit: Int? = null) =
        query(TodoEntity, where, args, orderBy, limit)

    fun todo(id: String?) = get(TodoEntity, id)
    fun tag(id: String?) = get(TagEntity, id)
    fun tags(where: String = "1", args: Array<String> = emptyArray(), orderBy: String? = null) = query(TagEntity, where, args, orderBy)

    /** Same sort as TagStore.undeletedTags */
    fun undeletedTags(where: String = "1", args: Array<String> = emptyArray()) =
        tags("deleted = 0 AND ($where)", args, "epic DESC, epicOrder ASC, numberOfUses DESC, tag ASC")

    fun epics() = undeletedTags("epic = 1")

    fun updateTodo(todo: Todo, change: (Todo) -> Unit) = edit(TodoEntity, todo, change)
    fun saveTodos(todos: Collection<Todo>) = save(TodoEntity, todos)
    fun updateTag(tag: Tag, change: (Tag) -> Unit) = edit(TagEntity, tag, change)

    fun users(isDelegator: Boolean): List<DelegationUser> =
        db.rawQuery("SELECT id, name FROM users WHERE isDelegator = ? ORDER BY name COLLATE NOCASE", arrayOf(if (isDelegator) "1" else "0")).use { c ->
            ArrayList<DelegationUser>().also { while (c.moveToNext()) it.add(DelegationUser(c.getString(0), c.getString(1), isDelegator)) }
        }

    fun delegates() = users(false)
    fun delegators() = users(true)
    fun userName(id: String?, isDelegator: Boolean) = id?.let { users(isDelegator).firstOrNull { u -> u.id == it }?.name }

    /** Replaces the delegation lists with the server's snapshot. Call inside [write]. */
    fun replaceUsers(delegates: List<DelegationUser>, delegators: List<DelegationUser>) = db.apply {
        delete("users", null, null)
        for (u in delegates + delegators) insert("users", null, ContentValues().apply {
            put("id", u.id); put("name", u.name); put("isDelegator", u.isDelegator)
        })
    }

    // endregion
}
