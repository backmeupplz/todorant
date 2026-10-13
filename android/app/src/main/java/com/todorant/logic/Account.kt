package com.todorant.logic

import com.todorant.BuildConfig
import com.todorant.data.Db
import com.todorant.data.Hero
import com.todorant.data.Session
import com.todorant.data.Settings
import com.todorant.data.SyncedPref
import com.todorant.data.User
import com.todorant.sync.Rest
import com.todorant.sync.Sync
import com.todorant.sync.serverUrl
import com.todorant.t
import com.todorant.ui.Ui
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

    /** Switches servers (blank: todorant's own). The account and its data live on the old one, so this signs out. */
    fun changeServer(input: String, onChanged: () -> Unit) {
        val url = if (input.isBlank()) BuildConfig.API else serverUrl(input)
        if (url == null) {
            Ui.error(t("serverInvalid"))
            return
        }
        fun change() {
            if (Session.user != null) logout()
            Rest.server = url.takeIf { it != BuildConfig.API }
            onChanged()
        }
        when {
            url == Rest.base -> onChanged()
            Session.user != null -> Ui.confirm(t("serverChange"), t("logout")) { change() }
            else -> change()
        }
    }
}
