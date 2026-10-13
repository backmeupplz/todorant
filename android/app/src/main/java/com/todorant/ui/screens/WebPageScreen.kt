package com.todorant.ui.screens

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.todorant.ui.Colors
import com.todorant.ui.Spinner
import com.todorant.ui.StackScreen
import androidx.compose.ui.graphics.toArgb

/**
 * A stack screen with a WebView (terms, privacy, Telegram and Google logins).
 * [onPageStarted] sees every navigation; [configure] can tweak the WebView before loading.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebPageScreen(
    title: String,
    url: String,
    configure: (WebView) -> Unit = {},
    onPageStarted: (WebView, String) -> Unit = { _, _ -> },
) {
    var loading by remember { mutableStateOf(true) }
    StackScreen(title) {
        Box(Modifier.fillMaxSize()) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        setBackgroundColor(Colors.background.toArgb())
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = onPageStarted(view, url)
                            override fun onPageFinished(view: WebView, url: String) { loading = false }
                        }
                        configure(this)
                        loadUrl(url)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            if (loading) Spinner()
        }
    }
}
