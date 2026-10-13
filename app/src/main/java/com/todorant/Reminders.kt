package com.todorant

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.todorant.data.Settings
import com.todorant.logic.parseTime
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Daily "time to plan" notification at Settings.planningReminderTime. A windowed alarm (no exact-alarm
 * permission needed) that re-arms itself every time it fires, after reboots and app updates.
 */
object Reminders {
    private const val CHANNEL = "todorant"

    private val alarms get() = App.context.getSystemService(AlarmManager::class.java)

    private fun intent() = PendingIntent.getBroadcast(
        App.context, 0, Intent(App.context, ReminderReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    fun schedule(time: String) {
        stop()
        val at = parseTime(time) ?: return
        var next = LocalDateTime.of(LocalDate.now(), at)
        if (!next.isAfter(LocalDateTime.now())) next = next.plusDays(1)
        val millis = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        alarms.setWindow(AlarmManager.RTC_WAKEUP, millis, 10 * 60 * 1000L, intent())
    }

    fun stop() = alarms.cancel(intent())

    /** Re-arms the alarm for the saved reminder time, if any */
    fun restore() { Settings.planningReminderTime?.let(::schedule) }

    /** Android 13+ needs POST_NOTIFICATIONS; the settings screen should request it before scheduling */
    fun permissionNeeded() = Build.VERSION.SDK_INT >= 33 &&
        App.context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    // ponytail: no-op — Android launchers only badge apps that post notifications; add a silent "N todos left" notification if anyone misses it
    fun updateBadge() {}

    internal fun notify(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Todorant-channel", NotificationManager.IMPORTANCE_DEFAULT).apply { enableVibration(true) }
        )
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE
        )
        manager.notify(
            1, Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
                .setContentText(t("planningReminderText")).setContentIntent(open).setAutoCancel(true).build()
        )
    }
}

/** Fires the reminder (no action) and re-arms it, also on boot and app updates */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == null) Reminders.notify(context)
        Reminders.restore()
    }
}
