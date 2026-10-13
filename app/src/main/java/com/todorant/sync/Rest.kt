package com.todorant.sync

import com.todorant.data.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.TimeUnit

/** REST endpoints of backend.todorant.com used by the app (rest.ts) */
object Rest {
    private val BASE = com.todorant.BuildConfig.API
    // Pings notice dead sync sockets (network switches) within seconds instead of minutes
    val http: OkHttpClient = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    class HttpError(message: String) : Exception(message)

    private suspend fun call(method: String, path: String, body: JSONObject? = null, token: String? = null): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url("$BASE$path").apply {
                token?.let { header("token", it) }
                method(method, body?.toString()?.toRequestBody(json))
            }.build()
            http.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching { JSONObject(text).optString("message") }.getOrNull()?.ifEmpty { null }
                    throw HttpError(message ?: "Request failed with status code ${response.code}")
                }
                text
            }
        }

    /** Bodies that are plain strings may come JSON-quoted */
    private fun unquote(text: String) = runCatching { JSONTokener(text).nextValue() as? String }.getOrNull() ?: text

    private suspend fun login(provider: String, body: JSONObject) = User(JSONObject(call("POST", "/v2/auth/$provider", body)))

    suspend fun loginGoogle(idToken: String) = login("google", JSONObject().put("accessToken", idToken))

    suspend fun loginAppleAndroid(idToken: String, name: String?) = login(
        "apple-firebase",
        JSONObject().put("client", "android").put("credential", JSONObject().put("oauthIdToken", idToken)).put("name", name)
    )

    suspend fun loginToken(token: String) = login("token", JSONObject().put("token", token))

    suspend fun setQrToken(uuid: String, token: String) = call("POST", "/login/qr_token", JSONObject().put("uuid", uuid), token)

    suspend fun sendFeedback(state: JSONObject, token: String) = call("POST", "/feedback", JSONObject().put("state", state), token)

    suspend fun sendData(data: JSONObject, token: String) = call("POST", "/data", JSONObject().put("data", data), token)

    suspend fun calendarAuthenticationURL(token: String) = unquote(call("GET", "/google/calendarAuthenticationURL", token = token))

    suspend fun calendarAuthorize(code: String, token: String) =
        JSONObject(call("POST", "/google/calendarAuthorize", JSONObject().put("code", code), token))

    private val token get() = com.todorant.data.Session.user?.token

    suspend fun resetDelegateToken() = JSONObject(call("POST", "/v2/delegation/token", JSONObject(), token)).getString("token")

    suspend fun acceptInvite(invite: String) = call("POST", "/v2/delegation/accept", JSONObject().put("token", invite), token)

    suspend fun removeDelegation(userId: String, isDelegator: Boolean) =
        call("DELETE", "/v2/delegation/${if (isDelegator) "delegators" else "delegates"}/$userId", token = token)
}
