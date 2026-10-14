import Foundation
import Security

/// SessionStore.login/logout
enum Account {
    static func login(_ user: User) async throws {
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
 * One-time upgrade from the React Native app installed under the same bundle id: it kept the login
 * token and the encryption password in the keychain (service "todorant") for its widgets and watch app.
 */
enum Migration {
    static func run() {
        if Prefs.bool("rnMigrationDone", false) { return }
        Prefs.shared.set("rnMigrationDone", true)
        if let password = keychain("password"), !password.isEmpty { Session.encryptionKey = password }
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
}
