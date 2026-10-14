import UserNotifications
import WidgetKit

/// Daily "time to plan" notification at Settings.planningReminderTime, a repeating local notification
enum Reminders {
    private static let id = "planning"
    private static var center: UNUserNotificationCenter { .current() }

    static func schedule(_ time: String) {
        stop()
        guard let (hour, minute) = parseTime(time) else { return }
        let content = UNMutableNotificationContent()
        content.body = t("planningReminderText")
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: minute), repeats: true)
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    static func stop() { center.removePendingNotificationRequests(withIdentifiers: [id]) }

    /// Re-arms the notification for the saved reminder time (and the current language), if any
    static func restore() { Settings.planningReminderTime.map(schedule) }

    /// Notifications and the icon badge need the user's permission; asks once, later calls return the answer
    static func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    /// Today's uncompleted count on the app icon
    static func updateBadge() {
        center.setBadgeCount(Settings.badgeIconCurrentCount && Session.user != nil ? Todos.forDay(todayTitle(), false).count : 0)
    }
}

/// The home screen widget reads the shared database; this asks WidgetKit to redraw it
enum Widget {
    private static var work: DispatchWorkItem?

    /// Debounced: a sync applies many writes in a row
    static func refresh() {
        work?.cancel()
        let w = DispatchWorkItem {
            Reminders.updateBadge()
            WidgetCenter.shared.reloadAllTimelines()
        }
        work = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: w)
    }
}
