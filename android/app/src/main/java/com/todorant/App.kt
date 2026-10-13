package com.todorant

import android.app.Application
import android.content.Context
import com.todorant.data.Db
import com.todorant.data.Prefs
import com.todorant.data.Session
import com.todorant.logic.Migration
import com.todorant.sync.Sync
import com.todorant.ui.Onboarding
import com.todorant.ui.Sounds
import com.todorant.ui.screens.AddTodoActions
import com.todorant.ui.screens.SettingsList
import com.todorant.widget.Widget
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        context = this
        Prefs.init(this)
        Db.init(this)
        I18n.init(this)
        Session.init()
        Sounds.init(this)
        Sync.start()
        Migration.run(this)
        Widget.init()
        Reminders.restore()
        // Glue between the tutorial and the screens it drives
        Onboarding.saveTodo = { AddTodoActions.save() }
        Onboarding.scrollToTarget = { target -> scope.launch { SettingsList.scrollTo(target) } }
    }

    companion object {
        lateinit var context: Context
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    }
}
