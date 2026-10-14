package com.todorant.ui.screens

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.todorant.BuildConfig
import com.todorant.data.User
import com.todorant.logic.Account
import com.todorant.sync.Rest
import com.todorant.t
import com.todorant.ui.Colors
import com.todorant.ui.Nav
import com.todorant.ui.PrimaryButton
import com.todorant.ui.Spinner
import com.todorant.ui.StackScreen
import com.todorant.ui.Ui
import org.json.JSONObject
import java.util.UUID

private const val GOOGLE_WEB_CLIENT_ID = "167486246043-304ktl4ng8njc185ov1f7vdoafj4gke8.apps.googleusercontent.com"

/** Scans a QR code with Google's scanner (no camera permission needed) */
internal fun scanQr(context: Context, onResult: (String) -> Unit) {
    Ui.toast(t("qrDescription"))
    GmsBarcodeScanning.getClient(context).startScan()
        .addOnSuccessListener { barcode -> barcode.rawValue?.takeIf { it.isNotEmpty() }?.let(onResult) }
        .addOnFailureListener { Ui.error(it.message ?: t("cameraAuthorization")) }
}

private class LoginState {
    var loading by mutableStateOf(false)
    var syncLoading by mutableStateOf(false)
    var appleOpen by mutableStateOf(false)

    /** Gets the user from [request], logs in and leaves the login screen */
    fun login(errorText: String? = null, request: suspend () -> User) {
        loading = true
        Ui.launch {
            try {
                val user = request()
                syncLoading = true
                Account.login(user)
                Nav.back()
            } catch (e: Exception) {
                if (errorText != null) Ui.error(errorText) else Ui.error(e)
            } finally {
                syncLoading = false
                loading = false
            }
        }
    }
}

@Composable
fun LoginScreen(wall: Boolean) {
    val state = remember { LoginState() }
    val context = LocalContext.current
    var debugToken by remember { mutableStateOf("") }
    // Self-hosted servers may have no OAuth apps: email + password comes first there
    val custom = Rest.server != null
    Box(Modifier.fillMaxSize()) {
        StackScreen(t("pleaseLogin")) {
            // imePadding: the keyboard mustn't cover the server field at the bottom
            Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (wall) Text(t("loginWall"), color = Colors.text, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp))
                if (state.loading) Spinner()
                if (custom) PasswordLogin(state)
                PrimaryButton(t("loginGoogle"), color = Color(0xFFFF6347), enabled = !state.loading) {
                    state.login {
                        val option = GetGoogleIdOption.Builder()
                            .setServerClientId(GOOGLE_WEB_CLIENT_ID)
                            .setFilterByAuthorizedAccounts(false)
                            .build()
                        val credential = CredentialManager.create(context)
                            .getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build()).credential
                        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                            throw Exception(t("googleTokenError"))
                        }
                        Rest.loginGoogle(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                    }
                }
                PrimaryButton(" Sign in with Apple", color = Color.Black, enabled = !state.loading) { state.appleOpen = true }
                // The Telegram page signs in on todorant.com only
                if (!custom) PrimaryButton(t("loginTelegram"), color = Color(0xFF1E90FF), enabled = !state.loading) { Nav.go(com.todorant.ui.Route.TELEGRAM) }
                PrimaryButton(t("loginQR"), color = Color(0xFF483D8B), enabled = !state.loading) {
                    scanQr(context) { token -> state.login { Rest.loginToken(token) } }
                }
                if (!custom) PasswordLogin(state)
                if (BuildConfig.DEBUG) {
                    SettingsField(debugToken, { debugToken = it }, "Enter token here")
                    PrimaryButton("Login with token", color = Color(0xFF483D8B), enabled = !state.loading) {
                        state.login { Rest.loginToken(debugToken.trim()) }
                    }
                }
                ServerSetting { address, open ->
                    Text(
                        "${t("server")}: $address", color = Colors.link, fontSize = 14.sp, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().clickable(onClick = open).padding(8.dp),
                    )
                }
            }
        }
        if (state.appleOpen) AppleSignIn(
            onClose = { state.appleOpen = false },
            onResult = { idToken, name ->
                state.appleOpen = false
                state.login(t("appleSigninError")) { Rest.loginAppleAndroid(idToken, name) }
            },
        )
        if (state.syncLoading) {
            Column(
                Modifier.fillMaxSize().background(Color(0xB3000000)),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = Colors.primary)
                Text(t("loadingData"), color = Color.White, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

/** Email + password: sign in, or create the account */
@Composable
private fun PasswordLogin(state: LoginState) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    SettingsField(email, { email = it }, t("email"), keyboardType = KeyboardType.Email)
    SettingsField(password, { password = it }, t("password"), password = true)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for ((title, signup) in listOf("signIn" to false, "signUp" to true)) {
            PrimaryButton(t(title), Modifier.weight(1f), enabled = !state.loading && email.isNotBlank() && password.isNotEmpty()) {
                if (password.length < 8) Ui.error(t("passwordLength")) else state.login { Rest.loginPassword(email, password, signup) }
            }
        }
    }
}

/**
 * Sign in with Apple on Android: Apple's page answers with a form POST to the redirect URI,
 * which a WebView can't read, so the form is captured with injected JS before it's sent.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
private fun AppleSignIn(onClose: () -> Unit, onResult: (idToken: String, name: String?) -> Unit) {
    BackHandler(onBack = onClose)
    val url = remember {
        Uri.parse("https://appleid.apple.com/auth/authorize").buildUpon()
            .appendQueryParameter("client_id", "com.todorant.web")
            .appendQueryParameter("redirect_uri", "https://backend.todorant.com/apple")
            .appendQueryParameter("response_type", "code id_token")
            .appendQueryParameter("scope", "name email")
            .appendQueryParameter("response_mode", "form_post")
            .appendQueryParameter("state", UUID.randomUUID().toString())
            .appendQueryParameter("nonce", UUID.randomUUID().toString())
            .build().toString()
    }
    val interceptor = """
        (function () {
          if (window.__todorantApple) return; window.__todorantApple = true;
          function grab(form) {
            try {
              var data = {};
              for (var i = 0; i < form.elements.length; i++) { var e = form.elements[i]; if (e.name) data[e.name] = e.value; }
              if (data.id_token) { TodorantApple.onForm(JSON.stringify(data)); return true; }
            } catch (e) {}
            return false;
          }
          var submit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function () { if (!grab(this)) submit.call(this); };
          document.addEventListener('submit', function (e) { if (grab(e.target)) e.preventDefault(); }, true);
        })();
    """.trimIndent()
    var done by remember { mutableStateOf(false) }
    StackScreen("Apple", onBack = onClose) {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    addJavascriptInterface(object {
                        @JavascriptInterface
                        fun onForm(json: String) {
                            if (done) return
                            done = true
                            val form = JSONObject(json)
                            val name = form.optString("user").takeIf { it.isNotEmpty() }?.let { user ->
                                runCatching {
                                    val n = JSONObject(user).getJSONObject("name")
                                    "${n.optString("firstName")} ${n.optString("lastName")}".trim().ifEmpty { null }
                                }.getOrNull()
                            }
                            Ui.launch { onResult(form.getString("id_token"), name) }
                        }
                    }, "TodorantApple")
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { view.evaluateJavascript(interceptor, null) }
                        override fun onPageFinished(view: WebView, url: String) { view.evaluateJavascript(interceptor, null) }
                    }
                    loadUrl(url)
                }
            },
            modifier = Modifier.fillMaxSize().background(Colors.background),
        )
    }
}

@Composable
fun TelegramLoginScreen() {
    var handled by remember { mutableStateOf(false) }
    WebPageScreen(t("loginTelegram"), "https://todorant.com/mobile-login/telegram", onPageStarted = { view, url ->
        if (!handled && url.contains("mobile_login_success")) {
            handled = true
            view.stopLoading()
            // decodeURI of everything after "data=": getQueryParameter would turn '+' into spaces and stop at '&'
            val data = url.substringAfter("mobile_login_success?data=", "").takeIf { it.isNotEmpty() }?.let { Uri.decode(it) }
            if (data == null) {
                Nav.back()
                Ui.error(t("error"))
                return@WebPageScreen
            }
            // Leave Telegram and the login screen; data loads in the background
            Nav.back(); Nav.back()
            Ui.attempt { Account.login(User(JSONObject(data))) }
        }
    })
}
