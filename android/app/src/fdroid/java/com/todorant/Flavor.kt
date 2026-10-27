package com.todorant

import android.app.Activity
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.Composable
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.todorant.ui.Ui

// F-Droid build: no Google code, so no Google sign-in or Play review card, and QR codes go through the open-source ZXing scanner (asks for the camera).

val googleIdToken: (suspend (Context) -> String)? = null

@Suppress("UNUSED_PARAMETER")
fun requestReview(activity: Activity) {}

/** Scans a QR code with ZXing */
@Composable
fun rememberQrScanner(onResult: (String) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val text = result.contents
        if (!text.isNullOrEmpty()) onResult(text)
        else if (result.originalIntent?.hasExtra(Intents.Scan.MISSING_CAMERA_PERMISSION) == true) Ui.error(t("cameraAuthorization"))
    }
    return {
        launcher.launch(
            ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt(t("qrDescription")).setBeepEnabled(false).setOrientationLocked(false)
                // ZXing's own dialog blames a camera fault; the error above says what happened
                .addExtra(Intents.Scan.SHOW_MISSING_CAMERA_PERMISSION_DIALOG, false),
        )
    }
}
