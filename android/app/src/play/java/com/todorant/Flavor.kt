package com.todorant

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.play.core.review.ReviewManagerFactory
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.todorant.ui.Ui

// Play build: Google sign-in, Google's QR scanner and Play's review card, all through Play services. src/fdroid has the Google-free versions.

private const val GOOGLE_WEB_CLIENT_ID = "167486246043-304ktl4ng8njc185ov1f7vdoafj4gke8.apps.googleusercontent.com"

/** Google's ID token from Credential Manager; null in builds without Google sign-in */
val googleIdToken: (suspend (Context) -> String)? = { context ->
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(GOOGLE_WEB_CLIENT_ID)
        .setFilterByAuthorizedAccounts(false)
        .build()
    val credential = CredentialManager.create(context)
        .getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build()).credential
    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        throw Exception(t("googleTokenError"))
    }
    GoogleIdTokenCredential.createFrom(credential.data).idToken
}

/** Scans a QR code with Google's scanner (no camera permission needed) */
@Composable
fun rememberQrScanner(onResult: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    return {
        Ui.toast(t("qrDescription"))
        GmsBarcodeScanning.getClient(context).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.takeIf { it.isNotEmpty() }?.let(onResult) }
            .addOnFailureListener { Ui.error(it.message ?: t("cameraAuthorization")) }
    }
}

/** Play's in-app review card; Play decides whether it really shows */
fun requestReview(activity: Activity) {
    val manager = ReviewManagerFactory.create(activity)
    manager.requestReviewFlow().addOnSuccessListener { manager.launchReviewFlow(activity, it) }
}
