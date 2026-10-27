package com.todorant.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RatingPromptTest {
    private fun ask(
        today: Long = 10, firstUse: Long = 0, activeDays: Int = 3, allDoneDays: Int = 3,
        requests: Int = 0, lastRequest: Long? = null, lastVersion: Int = 0, version: Int = 1,
    ) = RatingPrompt.shouldAsk(today, firstUse, activeDays, allDoneDays, requests, lastRequest, lastVersion, version)

    @Test
    fun rule() {
        assertTrue(ask())
        assertFalse(ask(activeDays = 2))
        assertFalse(ask(today = 2))
        assertTrue(ask(today = 3))
        assertFalse(ask(allDoneDays = 2))
        // The second request: 120 days later on a newer version
        assertTrue(ask(today = 130, requests = 1, lastRequest = 10, lastVersion = 1, version = 2))
        assertFalse(ask(today = 129, requests = 1, lastRequest = 10, lastVersion = 1, version = 2))
        assertFalse(ask(today = 130, requests = 1, lastRequest = 10, lastVersion = 2, version = 2))
        // Never a third
        assertFalse(ask(today = 1000, requests = 2, lastRequest = 130, lastVersion = 2, version = 9))
    }
}
