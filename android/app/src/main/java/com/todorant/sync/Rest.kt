package com.todorant.sync

import com.todorant.BuildConfig
import com.todorant.data.User
import com.todorant.data.optStringPref
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** A typed server address → its base URL (http or https, https when left out; no trailing slash), null when it isn't one */
fun serverUrl(input: String): String? = input.trim().let { if ("://" in it) it else "https://$it" }.toHttpUrlOrNull()
    ?.takeIf { it.query == null && it.fragment == null }?.toString()?.trimEnd('/')

/** REST endpoints of the backend used by the app (rest.ts) */
object Rest {
    /** A self-hosted server picked by the user, null for todorant's own */
    var server by optStringPref("server")
    val base get() = server ?: BuildConfig.API
    // Pings notice dead sync sockets (network switches) within seconds instead of minutes
    val http: OkHttpClient = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    class HttpError(message: String) : Exception(message)

    private suspend fun call(method: String, path: String, body: JSONObject? = null, token: String? = com.todorant.data.Session.user?.token): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url("$base$path").apply {
                token?.let { header("token", it) }
                method(method, body?.toString()?.toRequestBody(json))
            }.build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    // v1 answers {message}, v2 {error}
                    val message = runCatching { JSONObject(text).run { optString("message").ifEmpty { optString("error") } } }.getOrNull()?.ifEmpty { null }
                    throw HttpError(message ?: "Request failed with status code ${response.code}")
                }
                text
            }
        }

    private suspend fun login(provider: String, body: JSONObject) = User(JSONObject(call("POST", "/v2/auth/$provider", body, token = null)))

    suspend fun loginGoogle(idToken: String) = login("google", JSONObject().put("accessToken", idToken))

    suspend fun loginAppleAndroid(idToken: String, name: String?) = login(
        "apple-firebase",
        JSONObject().put("client", "android").put("credential", JSONObject().put("oauthIdToken", idToken)).put("name", name)
    )

    suspend fun loginToken(token: String) = login("token", JSONObject().put("token", token))

    /** Email + password: signs in, or creates the account with [signup] */
    suspend fun loginPassword(email: String, password: String, signup: Boolean) =
        login(if (signup) "signup" else "password", JSONObject().put("email", email.trim()).put("password", password))

    suspend fun setQrToken(uuid: String) = call("POST", "/login/qr_token", JSONObject().put("uuid", uuid))

    suspend fun sendFeedback(state: JSONObject) = call("POST", "/feedback", JSONObject().put("state", state))

    suspend fun sendData(data: JSONObject) = call("POST", "/data", JSONObject().put("data", data))

    suspend fun resetDelegateToken() = JSONObject(call("POST", "/v2/delegation/token", JSONObject())).getString("token")

    suspend fun acceptInvite(invite: String) = call("POST", "/v2/delegation/accept", JSONObject().put("token", invite))

    /** Deletes the account and everything in it on the server */
    suspend fun deleteAccount() = call("DELETE", "/v2/account")

    suspend fun removeDelegation(userId: String, isDelegator: Boolean) =
        call("DELETE", "/v2/delegation/${if (isDelegator) "delegators" else "delegates"}/$userId")
}
