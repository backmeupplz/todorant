package com.todorant.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.todorant.BuildConfig
import com.todorant.data.Session
import com.todorant.data.intPref
import com.todorant.data.optLongPref
import com.todorant.data.optStringPref
import com.todorant.logic.Todos
import com.todorant.requestReview
import kotlinx.coroutines.delay
import java.time.LocalDate

/**
 * Asks for a store rating with the store's own card only (Play's In-App Review; nothing in the F-Droid build), right after
 * an "all done" day: once the app was used on 3 days, at least 3 days after the first, and 3 days were all done.
 * At most twice per install, the second 120+ days later on a newer version. Nothing leaves the device.
 */
object RatingPrompt {
    private var firstUseDay by optLongPref("rating.firstUseDay")
    private var lastActiveDay by optLongPref("rating.lastActiveDay")
    private var activeDays by intPref("rating.activeDays", 0)
    private var lastAllDoneDay by optStringPref("rating.lastAllDoneDay")
    private var allDoneDays by intPref("rating.allDoneDays", 0)
    private var requests by intPref("rating.requests", 0)
    private var lastRequestDay by optLongPref("rating.lastRequestDay")
    private var lastRequestVersion by intPref("rating.lastRequestVersion", 0)

    /** Not after an error in the same session */
    var errored = false
    internal var due by mutableStateOf(false)

    fun appOpened() {
        val today = LocalDate.now().toEpochDay()
        if (firstUseDay == null) {
            firstUseDay = today
            // The old prompt (100 completed todos) already used one of the two requests
            if (Session.askedToRate) { requests = 1; lastRequestDay = today; lastRequestVersion = BuildConfig.VERSION_CODE }
        }
        if (lastActiveDay != today) { lastActiveDay = today; activeDays++ }
    }

    /** Every planned todo of [day] is done; counts each day once */
    fun dayCompleted(day: String) {
        if (lastAllDoneDay == day) return
        lastAllDoneDay = day
        allDoneDays++
        val today = LocalDate.now().toEpochDay()
        if (errored || !shouldAsk(today, firstUseDay ?: today, activeDays, allDoneDays, requests, lastRequestDay, lastRequestVersion, BuildConfig.VERSION_CODE)) return
        requests++
        lastRequestDay = today
        lastRequestVersion = BuildConfig.VERSION_CODE
        due = true
    }

    internal fun shouldAsk(
        today: Long, firstUseDay: Long, activeDays: Int, allDoneDays: Int, requests: Int, lastRequestDay: Long?, lastRequestVersion: Int, version: Int,
    ) = activeDays >= 3 && today - firstUseDay >= 3 && allDoneDays >= 3 && when (requests) {
        0 -> true
        1 -> lastRequestDay != null && today - lastRequestDay >= 120 && version > lastRequestVersion
        else -> false
    }
}

@Composable
fun RatingRequest() {
    val activity = LocalActivity.current ?: return
    LaunchedEffect(RatingPrompt.due) {
        if (!RatingPrompt.due) return@LaunchedEffect
        // After the 10 s "mission passed" overlay when it shows, else a beat after the last checkmark
        delay(if (Todos.shouldShowDayCompletion()) 11_000 else 2_000)
        RatingPrompt.due = false
        requestReview(activity)
    }
}
