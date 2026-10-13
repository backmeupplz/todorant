package com.todorant.sync

import android.net.ConnectivityManager
import android.net.Network
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.todorant.App
import com.todorant.BuildConfig
import com.todorant.data.Change
import com.todorant.data.Db
import com.todorant.data.DelegationUser
import com.todorant.data.Doc
import com.todorant.data.Entity
import com.todorant.data.Hero
import com.todorant.data.Invites
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.SyncedPref
import com.todorant.data.TagEntity
import com.todorant.data.TodoEntity
import com.todorant.data.optLongPref
import com.todorant.logic.Crypto
import com.todorant.ui.Ui
import com.todorant.widget.Widget
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "Sync"

/**
 * v2 sync over one WebSocket (`/v2/ws`): local edits are field changes in the outbox, pushed as soon as
 * they're made; the server resolves conflicts per field and streams other devices' changes back live.
 * A pull by cursor catches up after being offline.
 */
object Sync {
    var connected by mutableStateOf(false); private set
    var connectionError by mutableStateOf<String?>(null); private set
    private var inFlight by mutableIntStateOf(0)
    val isSyncing get() = inFlight > 0

    /** Server time of the last pull, null before the first (full) pull */
    private var cursor by optLongPref("sync.cursor")
    /** Server clock minus device clock */
    @Volatile private var offset = 0L

    @Volatile private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var pushJob: Job? = null
    private var attempts = 0
    private val requests = AtomicInteger()
    /** Outbox rows sent with each request, acknowledged when it's answered */
    private val sent = ConcurrentHashMap<Int, List<Change>>()
    private val waiting = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()

    fun start() {
        Db.now = { System.currentTimeMillis() + offset }
        Db.onLocalChange = ::schedulePush
        App.context.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = reconnect()
        })
        connect()
    }

    @Synchronized
    fun connect() {
        val token = Session.user?.token ?: return
        if (socket != null) return
        val url = BuildConfig.API.replaceFirst("http", "ws") + "/v2/ws?token=" + URLEncoder.encode(token, "UTF-8")
        socket = Rest.http.newWebSocket(Request.Builder().url(url).build(), Listener())
    }

    /** Connects right away (app resumed, network back), dropping a socket that never got going */
    fun reconnect() {
        reconnectJob?.cancel()
        attempts = 0
        synchronized(this) {
            if (!connected) {
                socket?.cancel()
                socket = null
            }
        }
        connect()
    }

    @Synchronized
    fun disconnect() {
        reconnectJob?.cancel()
        socket?.close(1000, null)
        socket = null
        connected = false
    }

    private class Listener : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            if (webSocket != socket) return
            App.scope.launch(Dispatchers.IO) {
                runCatching { handle(JSONObject(text)) }.onFailure { Log.w(TAG, "message", it) }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = closed(webSocket, t.message)
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = closed(webSocket, reason.ifEmpty { null })
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
    }

    private fun closed(webSocket: WebSocket, error: String?) {
        synchronized(this) {
            if (webSocket != socket) return
            socket = null
        }
        connected = false
        connectionError = error
        waiting.values.forEach { it.completeExceptionally(IllegalStateException(error ?: "Disconnected")) }
        waiting.clear()
        sent.clear()
        inFlight = 0
        if (Session.user == null) return
        // Exponential backoff up to 30 s; network and resume events reconnect sooner
        reconnectJob?.cancel()
        reconnectJob = App.scope.launch {
            delay(minOf(30_000L, 500L shl minOf(attempts++, 6)))
            connect()
        }
    }

    private fun handle(message: JSONObject) {
        when (message.optString("t")) {
            "hello" -> {
                offset = message.getLong("now") - System.currentTimeMillis()
                attempts = 0
                connected = true
                connectionError = null
                Invites.all.forEach(::acceptInvite)
                send(pull = true)
            }
            "synced" -> {
                val rid = message.optInt("rid")
                inFlight = maxOf(0, inFlight - 1)
                acknowledge(message.optJSONArray("acks"), sent.remove(rid).orEmpty())
                apply(message)
                waiting.remove(rid)?.complete(message)
                if (Db.outbox().any { c -> sent.values.none { c in it } }) schedulePush()
            }
            "changes" -> apply(message)
            "pull" -> send(pull = true)
            "error" -> {
                val rid = message.optInt("rid")
                inFlight = maxOf(0, inFlight - 1)
                sent.remove(rid)
                waiting.remove(rid)?.completeExceptionally(IllegalStateException(message.optString("message")))
                Log.w(TAG, "server error ${message.optString("message")}")
            }
        }
    }

    /** Sends the outbox (and pulls the delta when [pull]); returns the server's answer */
    private fun send(pull: Boolean = false): CompletableDeferred<JSONObject>? {
        val ws = socket ?: return null
        if (!connected) return null
        val changes = Db.outbox().filter { c -> sent.values.none { batch -> c in batch } }
        if (changes.isEmpty() && !pull) return null
        val rid = requests.incrementAndGet()
        val message = JSONObject().put("t", "sync").put("rid", rid)
        if (changes.isNotEmpty()) message.put("ops", ops(changes))
        if (pull) message.put("since", cursor ?: 0)
        Session.encryptionKey?.let { message.put("key", it) }
        sent[rid] = changes
        val deferred = CompletableDeferred<JSONObject>()
        waiting[rid] = deferred
        inFlight++
        if (!ws.send(message.toString())) {
            sent.remove(rid); waiting.remove(rid); inFlight--
            return null
        }
        return deferred
    }

    /** Field changes → ops, one per document and edit time; todo texts are encrypted on the way out */
    private fun ops(changes: List<Change>): JSONArray {
        val key = Session.encryptionKey
        val ops = JSONArray()
        for ((group, fields) in changes.groupBy { Triple(it.collection, it.id, it.at) }) {
            val (collection, id, at) = group
            val set = JSONObject()
            for (change in fields) set.put(change.field, change.value ?: JSONObject.NULL)
            if (collection == "todo" && key != null && set.optString("text").isNotEmpty()) {
                val encrypted = if (set.has("encrypted")) set.optBoolean("encrypted") else Db.todo(id)?.encrypted == true
                if (encrypted) set.put("text", Crypto.encrypt(set.getString("text"), key))
            }
            ops.put(JSONObject().put("c", collection).apply { if (id.isNotEmpty()) put("id", id) }.put("at", at).put("set", set))
        }
        return ops
    }

    /** Answered changes leave the outbox; fields that lost to newer writes come back as fixes */
    private fun acknowledge(acks: JSONArray?, batch: List<Change>) {
        Db.write { Db.acknowledge(batch) }
        if (acks == null) return
        val fixes = JSONObject()
        for (i in 0 until acks.length()) {
            val ack = acks.getJSONObject(i)
            if (ack.has("e")) Log.w(TAG, "rejected ${ack.optString("c")} ${ack.optString("id")}: ${ack.optString("e")}")
            val fix = ack.optJSONObject("fix") ?: continue
            when (val collection = ack.optString("c")) {
                "todo", "tag" -> fixes.put("${collection}s", (fixes.optJSONArray("${collection}s") ?: JSONArray()).put(fix.put("id", ack.optString("id"))))
                "settings" -> fixes.put("user", JSONObject().put("settings", fix))
                "hero" -> fixes.put("hero", fix)
            }
        }
        if (fixes.length() > 0) apply(fixes)
    }

    /** Applies server data: documents, profile/settings, hero, delegation lists, cursor */
    private fun apply(message: JSONObject) {
        val key = Session.encryptionKey
        fun <T : Doc> docs(entity: Entity<T>, name: String) {
            val list = message.optJSONArray(name) ?: return
            for (i in 0 until list.length()) {
                val json = list.getJSONObject(i)
                // Deltas carry changed fields only, so a text edit may come without the encrypted flag
                fun encrypted() = if (json.has("encrypted")) json.optBoolean("encrypted") else Db.todo(json.getString("id"))?.encrypted == true
                if (entity === TodoEntity && key != null && json.has("text") && encrypted()) {
                    Crypto.decrypt(json.getString("text"), key)?.let { json.put("text", it) }
                }
                Db.applyRemote(entity, json)
            }
        }
        Db.write {
            docs(TodoEntity, "todos")
            docs(TagEntity, "tags")
            message.optJSONObject("delegation")?.let { d ->
                fun users(name: String, isDelegator: Boolean) = d.optJSONArray(name)?.let { a ->
                    (0 until a.length()).map { a.getJSONObject(it).let { u -> DelegationUser(u.getString("id"), u.optString("name"), isDelegator) } }
                }.orEmpty()
                Db.replaceUsers(users("delegates", false), users("delegators", true))
            }
        }
        message.optJSONObject("user")?.let { profile ->
            if (profile.has("id")) Session.applyProfile(profile) else profile.optJSONObject("settings")?.let(Settings::applyServer)
        }
        message.optJSONObject("hero")?.let { hero ->
            Hero.points // registers its synced pref
            SyncedPref.apply("hero", hero)
            hero.optLong("updatedAt").takeIf { it > 0 }?.let { Hero.updatedAt = it }
        }
        if (message.has("cursor")) cursor = message.getLong("cursor")
        Widget.refresh()
    }

    /** Local changes go out after a short pause, so a burst of edits is one message */
    fun schedulePush() {
        pushJob?.cancel()
        pushJob = App.scope.launch(Dispatchers.IO) {
            delay(30)
            if (socket == null) connect() else send()
        }
    }

    /** Pushes and pulls now, waiting for the answer (login, the Data screen); throws when offline */
    suspend fun sync() {
        connect()
        withTimeout(30_000) {
            while (!connected) delay(50)
            (send(pull = true) ?: error("Not connected")).await()
        }
    }

    /** Pull everything again (Data screen) */
    suspend fun hardSync() {
        cursor = null
        sync()
    }

    suspend fun login() {
        cursor = null
        disconnect()
        sync()
    }

    fun logout() {
        disconnect()
        cursor = null
    }

    /** Fire-and-forget push + pull */
    fun request() {
        App.scope.launch(Dispatchers.IO) { runCatching { sync() }.onFailure { Log.w(TAG, "sync", it) } }
    }

    fun acceptInvite(token: String) {
        Invites.add(token)
        App.scope.launch(Dispatchers.IO) {
            runCatching { Rest.acceptInvite(token) }
                .onSuccess { Invites.remove(token) }
                .onFailure { e -> if (e is Rest.HttpError) { Invites.remove(token); Ui.error(e) } }
        }
    }
}
