import Foundation
import Observation

/// UserDefaults (shared with the widget) that views observe: every write bumps [version]
@Observable
final class Prefs {
    static let shared = Prefs()
    @ObservationIgnored let defaults = UserDefaults(suiteName: "group.com.todorant.app") ?? .standard
    private var version = 0

    func get(_ key: String) -> Any? {
        _ = version
        return defaults.object(forKey: key)
    }

    /// nil removes the key
    func set(_ key: String, _ value: Any?) {
        if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
        version += 1
    }

    static func bool(_ key: String, _ fallback: Bool) -> Bool { shared.get(key) as? Bool ?? fallback }
    static func int(_ key: String, _ fallback: Int) -> Int { shared.get(key) as? Int ?? fallback }
    static func string(_ key: String) -> String? { shared.get(key) as? String }
}

/**
 * A preference the server syncs (settings, hero points, name). Setting it queues the change like any
 * todo edit; [apply] takes a server value unless a local change of it is still waiting to be pushed.
 */
struct SyncedPref {
    let collection: String
    let field: String
    var toWire: (Any?) -> Any? = { $0 }
    let fromWire: (Any?) -> Any?

    var key: String { "\(collection).\(field)" }

    static let all: [SyncedPref] = [
        bool("showTodayOnAddTodo"), int("firstDayOfWeek"), string("startTimeOfDay"), bool("newTodosGoFirst"),
        bool("preserveOrderByTime"), bool("duplicateTagInBreakdown"), bool("showMoreByDefault"), string("language"),
        SyncedPref(collection: "user", field: "name", fromWire: { $0 as? String }),
        SyncedPref(collection: "hero", field: "points", fromWire: { ($0 as? NSNumber)?.intValue }),
    ]

    private static func bool(_ field: String) -> SyncedPref { SyncedPref(collection: "settings", field: field, fromWire: { ($0 as? NSNumber)?.boolValue }) }
    private static func int(_ field: String) -> SyncedPref { SyncedPref(collection: "settings", field: field, fromWire: { ($0 as? NSNumber)?.intValue }) }
    private static func string(_ field: String) -> SyncedPref { SyncedPref(collection: "settings", field: field, fromWire: { $0 as? String }) }

    static func get(_ collection: String, _ field: String) -> Any? { Prefs.shared.get("\(collection).\(field)") }

    static func set(_ collection: String, _ field: String, _ value: Any?) {
        let pref = all.first { $0.collection == collection && $0.field == field }!
        if same(value, Prefs.shared.get(pref.key)) { return }
        Prefs.shared.set(pref.key, value)
        Db.shared.write { Db.shared.enqueue(Change(collection: collection, id: "", field: field, value: pref.toWire(value), at: Db.now())) }
        Db.onLocalChange()
    }

    static func apply(_ collection: String, _ json: [String: Any]) {
        for pref in all where pref.collection == collection {
            guard let value = json[pref.field], !Db.shared.pendingFields(collection, "").contains(pref.field) else { continue }
            Prefs.shared.set(pref.key, pref.fromWire(value is NSNull ? nil : value))
        }
    }

    static func resetAll() { all.forEach { Prefs.shared.set($0.key, nil) } }
}

func isoToMillis(_ value: Any?) -> Int? {
    switch value {
    case let n as NSNumber: return n.intValue
    case let s as String:
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return (f.date(from: s) ?? ISO8601DateFormatter().date(from: s)).map { Int($0.timeIntervalSince1970 * 1000) }
    default: return nil
    }
}

/// The user's profile from the server plus the login token
struct User {
    let json: [String: Any]

    private func string(_ key: String) -> String? { (json[key] as? String).flatMap { $0.isEmpty ? nil : $0 } }
    var id: String? { string("_id") ?? string("id") }
    var token: String { string("token") ?? "" }
    var name: String { string("name") ?? "" }
    var email: String? { string("email") }
    var facebookId: String? { string("facebookId") }
    var telegramId: String? { string("telegramId") ?? (json["telegramId"] as? NSNumber)?.stringValue }
    var appleSubId: String? { string("appleSubId") }
    /// Email of an email + password account
    var passwordLogin: String? { string("passwordLogin") }
    var delegateInviteToken: String? { string("delegateInviteToken") }
    var updatedAt: Int? { isoToMillis(json["updatedAt"]).flatMap { $0 > 0 ? $0 : nil } }

    func with(_ key: String, _ value: Any) -> User {
        var json = json
        json[key] = value
        return User(json: json)
    }

    var jsonText: String { String(data: try! JSONSerialization.data(withJSONObject: json), encoding: .utf8)! }

    init(json: [String: Any]) { self.json = json }
    init?(text: String) {
        guard let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return nil }
        self.json = json
    }
}

enum Session {
    static var userJson: String? {
        get { Prefs.string("user") }
        set { Prefs.shared.set("user", newValue) }
    }
    static var user: User? { userJson.flatMap(User.init(text:)) }
    static func setUser(_ user: User?) { userJson = user?.jsonText }

    static var encryptionKey: String? {
        get { Prefs.string("encryptionKey") }
        set { Prefs.shared.set("encryptionKey", newValue) }
    }
    static var numberOfTodosCompleted: Int {
        get { Prefs.int("numberOfTodosCompleted", 0) }
        set { Prefs.shared.set("numberOfTodosCompleted", newValue) }
    }
    static var askedToRate: Bool {
        get { Prefs.bool("askedToRate", false) }
        set { Prefs.shared.set("askedToRate", newValue) }
    }

    /// The user's name, synced (the rest of the profile is read-only)
    static var name: String {
        get { SyncedPref.get("user", "name") as? String ?? "" }
        set { SyncedPref.set("user", "name", newValue) }
    }

    static var loggingOut: Bool {
        get { AppState.shared.loggingOut }
        set { AppState.shared.loggingOut = newValue }
    }
    static var isInitialSync: Bool {
        get { AppState.shared.isInitialSync }
        set { AppState.shared.isInitialSync = newValue }
    }

    static var needsToRequestRate: Bool { !askedToRate && numberOfTodosCompleted > 101 }
    static var delegateInviteLink: String { "https://todorant.com/invite/\(user?.delegateInviteToken ?? "")" }

    /// Server profile (keeps the token)
    static func applyProfile(_ profile: [String: Any]) {
        guard let token = user?.token else { return }
        var json = profile
        json["token"] = token
        setUser(User(json: json))
        SyncedPref.apply("user", profile)
        if let settings = profile["settings"] as? [String: Any] { Settings.applyServer(settings) }
    }
}

enum ColorMode: String { case auto, dark, light }

enum Settings {
    private static func synced<T>(_ field: String) -> T? { SyncedPref.get("settings", field) as? T }
    private static func setSynced(_ field: String, _ value: Any?) { SyncedPref.set("settings", field, value) }

    // Synced with the server, field by field
    static var showTodayOnAddTodo: Bool? { get { synced("showTodayOnAddTodo") } set { setSynced("showTodayOnAddTodo", newValue) } }
    static var firstDayOfWeek: Int? { get { synced("firstDayOfWeek") } set { setSynced("firstDayOfWeek", newValue) } }
    static var startTimeOfDay: String? { get { synced("startTimeOfDay") } set { setSynced("startTimeOfDay", newValue) } }
    static var newTodosGoFirst: Bool? { get { synced("newTodosGoFirst") } set { setSynced("newTodosGoFirst", newValue) } }
    static var preserveOrderByTime: Bool? { get { synced("preserveOrderByTime") } set { setSynced("preserveOrderByTime", newValue) } }
    static var duplicateTagInBreakdown: Bool? { get { synced("duplicateTagInBreakdown") } set { setSynced("duplicateTagInBreakdown", newValue) } }
    static var showMoreByDefault: Bool? { get { synced("showMoreByDefault") } set { setSynced("showMoreByDefault", newValue) } }
    static var language: String? { get { synced("language") } set { setSynced("language", newValue) } }
    /// When the server last changed settings
    static var updatedAt: Int? { get { Prefs.shared.get("settings.updatedAt") as? Int } set { Prefs.shared.set("settings.updatedAt", newValue) } }

    // Local only
    static var colorMode: ColorMode {
        get { Prefs.string("colorMode").flatMap(ColorMode.init(rawValue:)) ?? .auto }
        set { Prefs.shared.set("colorMode", newValue.rawValue) }
    }
    static var askBeforeDelete: Bool { get { Prefs.bool("askBeforeDelete", true) } set { Prefs.shared.set("askBeforeDelete", newValue) } }
    static var soundOn: Bool { get { Prefs.bool("soundOn", true) } set { Prefs.shared.set("soundOn", newValue) } }
    static var endOfDaySoundOn: Bool { get { Prefs.bool("endOfDaySoundOn", false) } set { Prefs.shared.set("endOfDaySoundOn", newValue) } }
    static var gamificationOn: Bool { get { Prefs.bool("gamificationOn", true) } set { Prefs.shared.set("gamificationOn", newValue) } }
    static var badgeIconCurrentCount: Bool { get { Prefs.bool("badgeIconCurrentCount", false) } set { Prefs.shared.set("badgeIconCurrentCount", newValue) } }
    static var planningReminderTime: String? { get { Prefs.string("planningReminderTime") } set { Prefs.shared.set("planningReminderTime", newValue) } }
    static var swipeActions: Bool { get { Prefs.bool("swipeActions", true) } set { Prefs.shared.set("swipeActions", newValue) } }
    /// "auto" or a language code picked by the user
    static var languageSelect: String? { get { Prefs.string("languageSelect") } set { Prefs.shared.set("languageSelect", newValue) } }

    /// Updated by the root view from the system appearance
    static var systemDark: Bool {
        get { AppState.shared.systemDark }
        set { if AppState.shared.systemDark != newValue { AppState.shared.systemDark = newValue } }
    }
    static var isDark: Bool { colorMode == .auto ? systemDark : colorMode == .dark }

    static var firstDayOfWeekSafe: Int { firstDayOfWeek ?? (language == "en" ? 0 : 1) }
    static var startTimeOfDaySafe: String { startTimeOfDay ?? "00:00" }

    static func applyServer(_ settings: [String: Any]) {
        let before = language
        SyncedPref.apply("settings", settings)
        updatedAt = isoToMillis(settings["updatedAt"])
        // A language picked on another device sticks after restarts too
        if let language, language != before { languageSelect = language }
    }

    static func logout() {
        updatedAt = nil
        soundOn = true
        endOfDaySoundOn = false
    }
}

enum Hero {
    static let ranks = [0, 5, 13, 42, 69, 85, 100, 221, 256, 300, 404, 777, 800, 1337, 1338, 2048, 9000, 12800, 1000000]

    /// Synced; the server keeps the highest value any device reports
    static var points: Int {
        get { SyncedPref.get("hero", "points") as? Int ?? 0 }
        set { SyncedPref.set("hero", "points", newValue) }
    }
    static var updatedAt: Int? { get { Prefs.shared.get("hero.updatedAt") as? Int } set { Prefs.shared.set("hero.updatedAt", newValue) } }

    private static func bracket() -> (Int, Int)? {
        var prev = 0
        for r in ranks {
            if (prev..<r).contains(points) { return (prev, r) }
            prev = r
        }
        return nil
    }

    static var rank: Int { bracket()?.0 ?? -1 }
    static var nextRank: Int { bracket()?.1 ?? -1 }
    static var rankIndex: Int { bracket().map { ranks.firstIndex(of: $0.1)! - 1 } ?? -1 }
    static var progress: Double { Double(points - rank) / Double(nextRank - rank) }
}

/// Invite links accepted while offline, retried on the next connection
enum Invites {
    static var all: [String] { Prefs.shared.get("invites.pending") as? [String] ?? [] }
    static func add(_ token: String) { if !all.contains(token) { Prefs.shared.set("invites.pending", all + [token]) } }
    static func remove(_ token: String) { Prefs.shared.set("invites.pending", all.filter { $0 != token }) }
}

enum TodoSection { case planning, completed }
enum DelegateSection { case toMe, byMe, completed }

/// Non-persisted UI state shared between screens (AppStateStore in the RN app)
@Observable
final class AppState {
    static let shared = AppState()
    var todoSection = TodoSection.planning
    var hash = [String]()
    var searchEnabled = false
    var searchQuery = ""
    var calendarEnabled = false
    var delegateSection = DelegateSection.toMe
    var loggingOut = false
    var isInitialSync = false
    var systemDark = false
}
