package com.todorant.sync

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.todorant.App
import com.todorant.data.Db
import com.todorant.data.Db.saveTag
import com.todorant.data.Db.saveTodo
import com.todorant.data.Db.saveUser
import com.todorant.data.Delegation
import com.todorant.data.DelegationUser
import com.todorant.data.Hero
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.Status
import com.todorant.data.Tag
import com.todorant.data.Todo
import com.todorant.data.User
import com.todorant.data.isoToMillis
import com.todorant.data.millisToIso
import com.todorant.data.optLongPref
import com.todorant.logic.Crypto
import com.todorant.logic.exactDate
import com.todorant.logic.monthAndYear
import com.todorant.t
import com.todorant.ui.Ui
import com.todorant.widget.Widget
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "Sync"

/**
 * Runs [block] once per burst of requests: callers wait for a run that started after their request,
 * and requests made while a run is in progress collapse into a single follow-up run.
 */
private class Coalescer {
    private val mutex = Mutex()
    @Volatile private var requested = false
    suspend fun run(block: suspend () -> Unit) {
        requested = true
        mutex.withLock {
            if (!requested) return
            requested = false
            block()
        }
    }
}

/** Generic "sync_<name>" protocol used for settings, user, hero and delegation (SyncManager.ts) */
private class SyncManager(
    val name: String,
    val lastSyncDate: () -> Long?,
    val onObjects: suspend (objects: Any, pushBack: suspend (Any) -> Any) -> Unit,
    val onCompleted: (() -> Unit)? = null,
) {
    private val pendingSyncs = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val pendingPushes = ConcurrentHashMap<String, CompletableDeferred<Any>>()
    private val coalescer = Coalescer()

    fun listen(socket: Socket) {
        socket.on("${name}_sync_request") { Sync.request(name) }
        socket.on(name) { args ->
            val syncId = args.getOrNull(1) as? String ?: return@on
            val objects = args.getOrNull(0) ?: JSONObject.NULL
            App.scope.launch(Dispatchers.IO) {
                try {
                    onObjects(objects) { pushBack(it, syncId) }
                    onCompleted?.invoke()
                    pendingSyncs.remove(syncId)?.complete(Unit)
                } catch (e: Exception) {
                    pendingSyncs.remove(syncId)?.completeExceptionally(e)
                }
            }
        }
        socket.on("${name}_pushed") { args ->
            val syncId = args.getOrNull(1) as? String ?: return@on
            pendingPushes.remove(syncId)?.complete(args.getOrNull(0) ?: JSONObject.NULL)
        }
        socket.on("${name}_sync_error") { args ->
            val error = Exception(args.getOrNull(0)?.toString() ?: "Sync error")
            val syncId = args.getOrNull(1) as? String
            if (syncId != null) {
                pendingSyncs.remove(syncId)?.completeExceptionally(error)
                pendingPushes.remove(syncId)?.completeExceptionally(error)
            }
        }
    }

    private suspend fun pushBack(objects: Any, syncId: String): Any {
        val deferred = CompletableDeferred<Any>()
        pendingPushes[syncId] = deferred
        Sync.socket.emit("push_$name", syncId, objects, Session.encryptionKey ?: JSONObject.NULL)
        return try { withTimeout(60_000) { deferred.await() } } finally { pendingPushes.remove(syncId) }
    }

    suspend fun sync() = coalescer.run {
        Sync.checkReady()
        Sync.busy {
            val syncId = UUID.randomUUID().toString()
            val deferred = CompletableDeferred<Unit>()
            pendingSyncs[syncId] = deferred
            Sync.socket.emit("sync_$name", lastSyncDate()?.let(::millisToIso) ?: JSONObject.NULL, syncId)
            try { withTimeout(90_000) { deferred.await() } } finally { pendingSyncs.remove(syncId) }
        }
    }
}

object Sync {
    enum class Kind { All, Todo, Tag, Settings, User, Hero, Delegation }

    val socket: Socket = IO.socket("https://ws.todorant.com", IO.Options().apply { reconnectionDelayMax = 5000 })

    var connected by mutableStateOf(false); private set
    var authorized by mutableStateOf(false); private set
    var connectionError by mutableStateOf<String?>(null); private set
    private var busyCount by mutableIntStateOf(0)
    val isSyncing get() = busyCount > 0

    private var token: String? = null
    private var pendingAuthorization: CompletableDeferred<Unit>? = null
    private val connectedSignal = mutableListOf<CompletableDeferred<Unit>>()

    /** WatermelonDB's lastPulledAt */
    private var lastPulledAt by optLongPref("wmdb.lastPulledAt")
    private val wmdbCoalescer = Coalescer()
    private var wmdbResponse: CompletableDeferred<Pair<JSONObject, Long>>? = null
    private var wmdbPushed: CompletableDeferred<Unit>? = null

    private val settings = SyncManager("settings", { Settings.updatedAt }, ::onSettings)
    private val user = SyncManager("user", { Session.user?.updatedAt }, ::onUser)
    private val hero = SyncManager("hero", { Hero.updatedAt }, ::onHero)
    private val delegation = SyncManager("delegate", { Delegation.updatedAt }, ::onDelegation) {
        Delegation.updatedAt = System.currentTimeMillis()
    }

    fun start() {
        listOf(settings, user, hero, delegation).forEach { it.listen(socket) }
        socket.on(Socket.EVENT_CONNECT) {
            Log.i(TAG, "connected")
            connected = true
            connectionError = null
            synchronized(connectedSignal) { connectedSignal.forEach { it.complete(Unit) }; connectedSignal.clear() }
            App.scope.launch(Dispatchers.IO) {
                if (token != null) runCatching { authorize(); sync(Kind.All) }.onFailure { Log.w(TAG, "sync on connect", it) }
            }
        }
        socket.on(Socket.EVENT_DISCONNECT) { connected = false; authorized = false }
        socket.on(Socket.EVENT_CONNECT_ERROR) { args -> connectionError = (args.firstOrNull() as? Exception)?.message ?: args.firstOrNull()?.toString() }
        socket.on("authorized") {
            Log.i(TAG, "authorized")
            authorized = true
            pendingAuthorization?.complete(Unit)
            pendingAuthorization = null
        }
        socket.on("wmdb") { request(Kind.Todo) }
        socket.on("return_wmdb") { args ->
            val changes = args.getOrNull(0) as? JSONObject ?: JSONObject()
            val timestamp = (args.getOrNull(1) as? Number)?.toLong() ?: System.currentTimeMillis()
            wmdbResponse?.complete(changes to timestamp) ?: Ui.error(t("syncError"))
        }
        socket.on("complete_wmdb") { wmdbPushed?.complete(Unit) }
        socket.on("wmdb_sync_error") { args ->
            val error = Exception(args.getOrNull(0)?.toString() ?: "Sync error")
            wmdbResponse?.completeExceptionally(error)
            wmdbPushed?.completeExceptionally(error)
        }
        token = Session.user?.token
        socket.connect()
    }

    /** Reconnects right away when the network comes back */
    fun reconnect() { if (!socket.connected()) socket.connect() }

    suspend fun <T> busy(block: suspend () -> T): T {
        withContext(Dispatchers.Main) { busyCount++ }
        try { return block() } finally { withContext(Dispatchers.Main) { busyCount-- } }
    }

    fun checkReady() {
        if (!connected) throw IllegalStateException("Socket sync: not connected to sockets")
        if (!authorized) throw IllegalStateException("Socket sync: not authorized")
        if (token == null) throw IllegalStateException("Socket sync: no authorization token provided")
    }

    private suspend fun authorize() {
        val token = token ?: throw IllegalStateException("Socket authorization: no authorization token provided")
        if (!socket.connected()) {
            // The RN app failed logins made while the socket was still connecting; wait for it instead
            val signal = CompletableDeferred<Unit>()
            synchronized(connectedSignal) { if (socket.connected()) signal.complete(Unit) else connectedSignal.add(signal) }
            socket.connect()
            withTimeout(20_000) { signal.await() }
        }
        if (authorized) return
        val deferred = CompletableDeferred<Unit>()
        pendingAuthorization = deferred
        socket.emit("authorize", token, "2")
        try {
            withTimeout(20_000) { deferred.await() }
        } catch (e: Exception) {
            throw IllegalStateException("Socket authorization: operation timed out")
        }
    }

    suspend fun login(token: String) {
        this.token = token
        authorize()
        sync(Kind.All)
    }

    fun logout() {
        token = null
        authorized = false
        lastPulledAt = null
        if (socket.connected()) socket.emit("logout")
    }

    /** Fire-and-forget sync (requestSync in the RN app) */
    fun request(kind: Kind = Kind.All) {
        if (token == null) return
        App.scope.launch(Dispatchers.IO) { runCatching { sync(kind) }.onFailure { Log.w(TAG, "sync $kind", it) } }
    }

    fun request(name: String) = request(
        when (name) {
            "settings" -> Kind.Settings; "user" -> Kind.User; "hero" -> Kind.Hero; "delegate" -> Kind.Delegation; else -> Kind.All
        }
    )

    suspend fun sync(kind: Kind = Kind.All) {
        withContext(Dispatchers.IO) {
            when (kind) {
                Kind.All -> coroutineScope {
                    launch { settings.sync() }
                    launch { user.sync() }
                    launch { hero.sync() }
                    // Delegation users have to be known before todos are pulled
                    delegation.sync()
                    wmdbSync()
                }
                Kind.Todo, Kind.Tag -> wmdbSync()
                Kind.Settings -> settings.sync()
                Kind.User -> user.sync()
                Kind.Hero -> hero.sync()
                Kind.Delegation -> delegation.sync()
            }
        }
    }

    /** Outdates local versions so everything is pulled again (hardSync) */
    suspend fun hardSync() {
        Settings.updatedAt = null
        Session.user?.let { u -> Session.setUser(u.with { remove("updatedAt") }) }
        Hero.updatedAt = null
        sync(Kind.All)
    }

    // region Settings, user, hero

    private suspend fun onSettings(objects: Any, pushBack: suspend (Any) -> Any) {
        val server = objects as? JSONObject ?: JSONObject()
        val serverUpdatedAt = isoToMillis(server.opt("updatedAt"))
        val local = Settings.updatedAt
        val languageBefore = Settings.language
        when {
            // First pull
            local == null && serverUpdatedAt != null -> Settings.fromJson(server)
            // First push (or first pull of settings that were never set)
            local == null || serverUpdatedAt == null -> {
                if (local == null) Settings.fromJson(server.put("updatedAt", JSONObject.NULL))
                Settings.fromJson(pushBack(Settings.toJson()) as JSONObject)
            }
            local < serverUpdatedAt -> Settings.fromJson(server)
            local > serverUpdatedAt -> Settings.fromJson(pushBack(Settings.toJson()) as JSONObject)
        }
        // Language picked on another device sticks after restarts too
        Settings.language.takeIf { it != null && it != languageBefore }?.let { Settings.languageSelect = it }
    }

    private suspend fun onUser(objects: Any, pushBack: suspend (Any) -> Any) {
        val server = User(objects as? JSONObject ?: return)
        val local = Session.user
        if (local == null || local.updatedAt == null || server.updatedAt == null || local.updatedAt!! < server.updatedAt!!) {
            Session.setUser(server.with { local?.token?.let { put("token", it) } })
        } else if (!local.partiallyEquals(server)) {
            val pushed = pushBack(local.with { put("_id", server.id) }.json) as JSONObject
            Session.setUser(local.with {
                remove("subscriptionId"); remove("appleReceipt"); remove("appleSubId")
                pushed.keys().forEach { put(it, pushed.get(it)) }
                put("token", local.token)
            })
        } else {
            Session.setUser(local.with { put("updatedAt", server.json.opt("updatedAt")) })
        }
        val user = Session.user ?: return
        if (user.delegateInviteToken == null && user.token.isNotEmpty()) {
            val token = Rest.resetDelegateToken(user.token)
            Session.user?.let { Session.setUser(it.with { put("delegateInviteToken", token) }) }
        }
    }

    private suspend fun onHero(objects: Any, pushBack: suspend (Any) -> Any) {
        val server = objects as? JSONObject ?: JSONObject()
        val serverUpdatedAt = isoToMillis(server.opt("updatedAt"))
        val local = Hero.updatedAt
        suspend fun push() {
            val pushed = pushBack(JSONObject().put("points", Hero.points)) as JSONObject
            Hero.points = pushed.optInt("points", Hero.points)
            Hero.updatedAt = isoToMillis(pushed.opt("updatedAt"))
        }
        when {
            local == null && serverUpdatedAt != null -> { Hero.points = server.optInt("points"); Hero.updatedAt = serverUpdatedAt }
            local == null -> { Hero.points = server.optInt("points"); push() }
            serverUpdatedAt == null -> push()
            local < serverUpdatedAt -> { Hero.points = server.optInt("points"); Hero.updatedAt = serverUpdatedAt }
            local > serverUpdatedAt -> push()
        }
    }

    // endregion

    // region Delegation (onDelegationObjectsFromServer)

    private fun JSONObject.toDelegationJson(user: DelegationUser) = apply {
        put("_id", user.serverId ?: JSONObject.NULL)
        put("name", user.name ?: JSONObject.NULL)
        put("updatedAt", millisToIso(user.updatedAt))
        put("delegateInviteToken", user.delegateInviteToken ?: JSONObject.NULL)
        put("deleted", user.deleted)
    }

    private fun localDelegation(serverId: String?, inviteToken: String?, delegator: Boolean) = Db.users(
        "is_delegator = ? AND (server_id = ? OR delegate_invite_token = ?)",
        arrayOf(if (delegator) "1" else "0", serverId ?: "\u0000", inviteToken ?: "\u0000")
    ).firstOrNull()

    /** Pending local changes (accepted invites, deletions) survive until they're pushed unless [pushed] */
    private fun upsertDelegation(json: JSONObject, delegator: Boolean, pushed: Boolean = false) {
        val serverId = json.optString("_id").ifEmpty { null }
        val token = json.optString("delegateInviteToken").ifEmpty { null }
        val user = localDelegation(serverId, token, delegator) ?: DelegationUser(isDelegator = delegator)
        user.serverId = serverId ?: user.serverId
        user.name = json.optString("name").ifEmpty { null } ?: user.name
        user.delegateInviteToken = token ?: user.delegateInviteToken
        if (pushed) user.pending = false
        Db.write { saveUser(user) }
    }

    /** Removes a delegate/delegator and hides the todos shared with them (local only, like a server-side unlink) */
    private fun removeDelegation(user: DelegationUser) {
        val column = if (user.isDelegator) "delegator_id" else "user_id"
        Db.write {
            user.serverId?.let { id ->
                execSQL("UPDATE todos SET is_deleted = 1, is_delegate_accepted = 1 WHERE $column = ?", arrayOf(id))
            }
            delete("users", "id = ?", arrayOf(user.id))
        }
    }

    private suspend fun onDelegation(objects: Any, pushBack: suspend (Any) -> Any) {
        if (Session.user?.id == null) return
        val server = objects as? JSONObject ?: JSONObject()
        val delegators = server.optJSONArray("delegators") ?: JSONArray()
        val delegates = server.optJSONArray("delegates") ?: JSONArray()
        // Full lists: drop local users the server doesn't know anymore
        if (server.optBoolean("delegateUpdated") && Delegation.updatedAt != null) {
            for ((list, isDelegator) in listOf(delegators to true, delegates to false)) {
                val ids = (0 until list.length()).map { list.getJSONObject(it).optString("_id") }.toSet()
                Db.users("is_delegator = ? AND pending = 0 AND server_id IS NOT NULL", arrayOf(if (isDelegator) "1" else "0"))
                    .filter { it.serverId !in ids }.forEach(::removeDelegation)
            }
        }
        for (i in 0 until delegators.length()) upsertDelegation(delegators.getJSONObject(i), true)
        for (i in 0 until delegates.length()) upsertDelegation(delegates.getJSONObject(i), false)

        val pending = Db.users("pending = 1")
        if (pending.isEmpty()) return
        val pushed = pushBack(JSONObject().apply {
            put("delegates", JSONArray(pending.filter { !it.isDelegator }.map { JSONObject().toDelegationJson(it) }))
            put("delegators", JSONArray(pending.filter { it.isDelegator }.map { JSONObject().toDelegationJson(it) }))
        }) as JSONObject
        val pushedDelegators = pushed.optJSONArray("delegators") ?: JSONArray()
        for (i in 0 until pushedDelegators.length()) {
            val json = pushedDelegators.getJSONObject(i)
            val local = localDelegation(json.optString("_id").ifEmpty { null }, json.optString("delegateInviteToken").ifEmpty { null }, true)
                ?: continue
            when {
                json.optBoolean("invalid") || json.optBoolean("deleted") -> removeDelegation(local)
                else -> upsertDelegation(json, true, pushed = true)
            }
        }
        pending.filter { !it.isDelegator && it.deleted }.forEach(::removeDelegation)
        // Anything else that was pending is now known by the server
        Db.write { execSQL("UPDATE users SET pending = 0") }
    }

    // endregion

    // region WatermelonDB-compatible todos and tags sync (wmdbsync.ts)

    suspend fun wmdbSync() = wmdbCoalescer.run {
        try {
            checkReady()
        } catch (e: Exception) {
            return@run
        }
        busy {
            try {
                // Pull
                val response = CompletableDeferred<Pair<JSONObject, Long>>()
                wmdbResponse = response
                socket.emit("get_wmdb", lastPulledAt ?: JSONObject.NULL)
                val (changes, timestamp) = withTimeout(60_000) { response.await() }
                wmdbResponse = null
                applyRemote(changes)
                lastPulledAt = timestamp
                // Push
                pushLocal(timestamp)
            } catch (e: Exception) {
                Log.w(TAG, "wmdb sync", e)
                Ui.error(e.message ?: e.toString())
            } finally {
                wmdbResponse = null
                wmdbPushed = null
                Widget.refresh()
            }
        }
    }

    private fun JSONObject.optStr(key: String) = if (isNull(key)) null else optString(key)
    private fun JSONObject.optBoolOrNull(key: String) = if (isNull(key)) null else optBoolean(key)

    private fun applyRemote(changes: JSONObject) {
        val key = Session.encryptionKey
        val todos = changes.optJSONObject("todos")?.optJSONArray("updated") ?: JSONArray()
        val tags = changes.optJSONObject("tags")?.optJSONArray("updated") ?: JSONArray()
        Db.write {
            for (i in 0 until tags.length()) {
                val raw = tags.getJSONObject(i)
                val serverId = raw.optStr("server_id")
                val local = findLocal("tags", serverId, raw.optStr("client_id"))?.let { Db.tag(it) }
                val remote = Tag(
                    id = local?.id ?: serverId ?: continue, serverId = serverId,
                    createdAt = isoToMillis(raw.opt("created_at")) ?: 0, updatedAt = isoToMillis(raw.opt("updated_at")) ?: 0,
                    deleted = raw.optBoolean("is_deleted"), tag = raw.optString("tag"), color = raw.optStr("color"),
                    numberOfUses = raw.optInt("number_of_uses"), epic = raw.optBoolOrNull("is_epic"),
                    epicGoal = raw.optStr("epic_goal")?.toDoubleOrNull()?.toInt(), epicCompleted = raw.optBoolOrNull("is_epic_completed"),
                    epicPoints = raw.optStr("epic_points")?.toDoubleOrNull()?.toInt(), epicOrder = raw.optStr("epic_order")?.toDoubleOrNull()?.toInt(),
                    status = Status.SYNCED,
                )
                if (local == null || local.status == Status.SYNCED || remote.updatedAt > local.updatedAt) saveTag(remote, local = false)
                else { local.serverId = serverId; saveTag(local, local = false) }
            }
            for (i in 0 until todos.length()) {
                val raw = todos.getJSONObject(i)
                val serverId = raw.optStr("server_id")
                val local = findLocal("todos", serverId, raw.optStr("client_id"))?.let { Db.todo(it) }
                val encrypted = raw.optBoolean("is_encrypted")
                var text = raw.optString("text")
                if (encrypted && key != null) text = Crypto.decrypt(text, key) ?: text
                // The RN app hid delegated todos that arrived before their users were synced, forever;
                // here they're kept and the delegation screen only lists todos of known users.
                val delegatorId = raw.optJSONObject("delegator_id")?.optStr("_id")
                val userId = if (delegatorId == null) null else raw.optJSONObject("user_id")?.optStr("_id") ?: raw.optStr("user_id")
                val remote = Todo(
                    id = local?.id ?: serverId ?: continue, serverId = serverId,
                    createdAt = isoToMillis(raw.opt("created_at")) ?: 0, updatedAt = isoToMillis(raw.opt("updated_at")) ?: 0,
                    text = text, completed = raw.optBoolean("is_completed"), frog = raw.optBoolean("is_frog"),
                    frogFails = raw.optInt("frog_fails"), skipped = raw.optBoolean("is_skipped"), order = raw.optDouble("order", 0.0),
                    monthAndYear = raw.optStr("month_and_year"), deleted = raw.optBoolean("is_deleted"), encrypted = encrypted,
                    date = raw.optStr("date"), time = raw.optStr("time"), repetitive = raw.optBoolean("is_repetitive"),
                    delegateAccepted = raw.optBoolOrNull("is_delegate_accepted"), userId = userId, delegatorId = delegatorId,
                    status = Status.SYNCED,
                )
                remote.exactDate = exactDate(remote.title)
                // Newer version wins (the RN conflict resolver), but never lose the server id
                if (local == null || local.status == Status.SYNCED || remote.updatedAt > local.updatedAt) saveTodo(remote, local = false)
                else { local.serverId = serverId; saveTodo(local, local = false) }
            }
        }
    }

    private fun findLocal(table: String, serverId: String?, clientId: String?): String? =
        Db.db.rawQuery("SELECT id FROM $table WHERE server_id = ? OR id = ? LIMIT 1", arrayOf(serverId ?: "\u0000", clientId ?: "\u0000"))
            .use { if (it.moveToFirst()) it.getString(0) else null }

    private fun Todo.raw(key: String?) = JSONObject().apply {
        // Server matches by client id only for todos it doesn't know yet
        if (serverId == null) put("id", id)
        put("server_id", serverId ?: JSONObject.NULL)
        put("created_at", createdAt); put("updated_at", updatedAt)
        put("text", if (encrypted && key != null) Crypto.encrypt(text, key) else text)
        put("is_completed", completed); put("is_frog", frog); put("frog_fails", frogFails); put("is_skipped", skipped)
        put("order", order)
        put("month_and_year", monthAndYear ?: if (delegatorId != null) LocalDate.now().monthAndYear() else JSONObject.NULL)
        put("is_deleted", deleted); put("is_encrypted", encrypted)
        put("date", date ?: JSONObject.NULL); put("time", time ?: JSONObject.NULL); put("is_repetitive", repetitive)
        put("is_delegate_accepted", delegateAccepted ?: JSONObject.NULL)
        userId?.let { put("user_id", it) }
        delegatorId?.let { put("delegator_id", it) }
        put("exact_date_at", exactDate ?: JSONObject.NULL)
        put("_status", status); put("_changed", "")
    }

    private fun Tag.raw() = JSONObject().apply {
        put("id", id); put("server_id", serverId ?: JSONObject.NULL)
        put("created_at", createdAt); put("updated_at", updatedAt); put("is_deleted", deleted)
        put("tag", tag); put("color", color ?: JSONObject.NULL); put("number_of_uses", numberOfUses)
        put("is_epic", epic ?: JSONObject.NULL); put("epic_goal", epicGoal ?: JSONObject.NULL)
        put("is_epic_completed", epicCompleted ?: JSONObject.NULL); put("epic_points", epicPoints ?: JSONObject.NULL)
        put("epic_order", epicOrder ?: JSONObject.NULL); put("_status", status); put("_changed", "")
    }

    private suspend fun pushLocal(lastPulledAt: Long) {
        val todos = Db.todos("_status != ?", arrayOf(Status.SYNCED))
        val tags = Db.tags("_status != ?", arrayOf(Status.SYNCED))
        if (todos.isEmpty() && tags.isEmpty()) return
        val key = Session.encryptionKey
        // Chunks of 1000 like the RN app; tags go with the first chunk
        val chunks = todos.chunked(1000).ifEmpty { listOf(emptyList()) }
        chunks.forEachIndexed { i, chunk ->
            fun table(updated: List<JSONObject>) = JSONObject()
                .put("created", JSONArray()).put("updated", JSONArray(updated)).put("deleted", JSONArray())
            val changes = JSONObject()
                .put("todos", table(chunk.map { it.raw(key) }))
                .put("tags", table(if (i == 0) tags.map { it.raw() } else emptyList()))
            val pushed = CompletableDeferred<Unit>()
            wmdbPushed = pushed
            socket.emit("push_wmdb", changes, lastPulledAt, key ?: JSONObject.NULL)
            withTimeout(60_000) { pushed.await() }
            // Only records that didn't change while pushing are synced now
            Db.write {
                chunk.forEach { execSQL("UPDATE todos SET _status = ? WHERE id = ? AND updated_at = ?", arrayOf<Any>(Status.SYNCED, it.id, it.updatedAt)) }
                if (i == 0) tags.forEach { execSQL("UPDATE tags SET _status = ? WHERE id = ? AND updated_at = ?", arrayOf<Any>(Status.SYNCED, it.id, it.updatedAt)) }
            }
        }
    }

    // endregion
}
