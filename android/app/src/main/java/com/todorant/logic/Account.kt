package com.todorant.logic

import com.todorant.data.Db
import com.todorant.data.Hero
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.SyncedPref
import com.todorant.data.User
import com.todorant.sync.Sync
import com.todorant.widget.Widget

/** SessionStore.login/logout */
object Account {
    suspend fun login(user: User) {
        Session.setUser(user)
        Session.isInitialSync = true
        try {
            Sync.login()
        } finally {
            Session.isInitialSync = false
            Widget.refresh()
        }
    }

    fun logout() {
        Session.loggingOut = true
        try {
            Sync.logout()
            Session.setUser(null)
            Session.encryptionKey = null
            Db.clear()
            Hero.points // touch so its synced pref is registered before resetting
            SyncedPref.resetAll()
            Settings.logout()
            Hero.updatedAt = null
            Widget.refresh()
        } finally {
            Session.loggingOut = false
        }
    }
}
