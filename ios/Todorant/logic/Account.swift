import Foundation
import Security
import SQLite3

/// SessionStore.login/logout
enum Account {
    // The main actor: the database and the sync engine live on the main thread
    @MainActor static func login(_ user: User) async throws {
        Session.setUser(user)
        Session.isInitialSync = true
        defer {
            Session.isInitialSync = false
            Widget.refresh()
        }
        try await Sync.shared.login()
    }

    static func logout() {
        Session.loggingOut = true
        defer { Session.loggingOut = false }
        // The side column stays open across tabs; the old account's todo must not be saved after its data is gone
        Nav.closeEditor()
        Sync.shared.logout()
        Session.setUser(nil)
        Session.encryptionKey = nil
        Db.shared.clear()
        SyncedPref.resetAll()
        Settings.logout()
        Hero.updatedAt = nil
        Widget.refresh()
    }

    /// Switches servers (blank: todorant's own). The account and its data live on the old one, so this signs out.
    static func changeServer(_ input: String, _ onChanged: @escaping () -> Void) {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        guard let url = trimmed.isEmpty ? Rest.API : serverUrl(trimmed) else {
            Ui.error(t("serverInvalid"))
            return
        }
        func change() {
            if Session.user != nil { logout() }
            Rest.server = url == Rest.API ? nil : url
            onChanged()
        }
        if url == Rest.base { onChanged() }
        else if Session.user != nil { Ui.confirm(t("serverChange"), t("logout")) { change() } }
        else { change() }
    }
}

/**
 * One-time upgrade from the React Native app installed under the same bundle id:
 * - the login token and encryption password it kept in the keychain (service "todorant") for its widgets
 * - todos and tags in its WatermelonDB that never reached the server (anonymous users have only those)
 */
enum Migration {
    static func run() {
        if Prefs.bool("rnMigrationDone", false) { return }
        Prefs.shared.set("rnMigrationDone", true)
        if let password = keychain("password"), !password.isEmpty { Session.encryptionKey = password }
        if importWatermelon() > 0 { Onboarding.tutorialIsShown = true }
        guard let token = keychain("accessToken"), !token.isEmpty, token != "delete", Session.user == nil else { return }
        Onboarding.tutorialIsShown = true
        Task { @MainActor in
            do { try await Account.login(try await Rest.loginToken(token)) } catch { print("Migration login: \(error)") }
        }
    }

    /// SwiftKeychainWrapper's generic password item: account and generic = the key as UTF-8 data
    private static func keychain(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "todorant",
            kSecAttrAccount as String: Data(key.utf8), kSecAttrGeneric as String: Data(key.utf8), kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Imports unsynced records from Documents/watermelon.db; returns > 0 when the old app had any todos
    static func importWatermelon(_ path: String = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("watermelon.db").path) -> Int {
        var old: OpaquePointer?
        guard FileManager.default.fileExists(atPath: path), sqlite3_open_v2(path, &old, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { return 0 }
        defer { sqlite3_close(old) }
        /// Rows as column name → value
        func rows(_ sql: String) -> [[String: Any]] {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(old, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            var out = [[String: Any]]()
            while sqlite3_step(stmt) == SQLITE_ROW {
                var row = [String: Any]()
                for i in 0..<sqlite3_column_count(stmt) {
                    let name = String(cString: sqlite3_column_name(stmt, i))
                    switch sqlite3_column_type(stmt, i) {
                    case SQLITE_INTEGER, SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, i)
                    case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, i))
                    default: break
                    }
                }
                out.append(row)
            }
            return out
        }
        let anyTodos = ((rows("SELECT COUNT(*) AS n FROM todos").first?["n"] as? Double) ?? 0) > 0
        var serverIds = [String: String]()
        for u in rows("SELECT id, server_id FROM users WHERE server_id IS NOT NULL") { serverIds[u["id"] as! String] = u["server_id"] as? String }
        func str(_ r: [String: Any], _ c: String) -> String? { r[c] as? String }
        func num(_ r: [String: Any], _ c: String) -> Double? { r[c] as? Double }
        func flag(_ r: [String: Any], _ c: String) -> Bool? { num(r, c).map { $0 != 0 } }
        // Server id when there is one, otherwise a fresh ObjectId (WatermelonDB ids aren't valid server ids)
        func id(_ r: [String: Any]) -> String { str(r, "server_id") ?? Ids.new() }
        let todos = rows("SELECT * FROM todos WHERE _status != 'synced'").map { r in
            Todo(id: id(r), text: str(r, "text") ?? "", completed: flag(r, "is_completed") == true, frog: flag(r, "is_frog") == true,
                 frogFails: Int(num(r, "frog_fails") ?? 0), skipped: flag(r, "is_skipped") == true, order: num(r, "order") ?? 0,
                 monthAndYear: str(r, "month_and_year"), date: str(r, "date"), time: str(r, "time"), deleted: flag(r, "is_deleted") == true,
                 encrypted: flag(r, "is_encrypted") == true, repetitive: flag(r, "is_repetitive") == true, delegateAccepted: flag(r, "is_delegate_accepted"),
                 // WatermelonDB referenced local user rows; this app references server ids
                 userId: str(r, "delegator_id") != nil ? str(r, "user_id").flatMap { serverIds[$0] } : nil,
                 delegatorId: str(r, "delegator_id").flatMap { serverIds[$0] }, createdAt: Int(num(r, "created_at") ?? 0))
        }
        let tags = rows("SELECT * FROM tags WHERE _status != 'synced'").map { r in
            Tag(id: id(r), tag: str(r, "tag") ?? "", color: str(r, "color"), deleted: flag(r, "is_deleted") == true, epic: flag(r, "is_epic") == true,
                epicCompleted: flag(r, "is_epic_completed") == true, epicGoal: Int(num(r, "epic_goal") ?? 0), epicPoints: Int(num(r, "epic_points") ?? 0),
                epicOrder: Int(num(r, "epic_order") ?? 0), numberOfUses: Int(num(r, "number_of_uses") ?? 0), createdAt: Int(num(r, "created_at") ?? 0))
        }
        // New to this app: every field gets queued for the server
        Db.shared.save(TodoEntity, todos)
        Db.shared.save(TagEntity, tags)
        return todos.count + tags.count + (anyTodos ? 1 : 0)
    }
}
