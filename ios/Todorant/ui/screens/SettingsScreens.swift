import SwiftUI

struct RulesScreen: View {
    var body: some View {
        List(0..<17, id: \.self) { i in
            Text("\(i + 1). \(t("rules.\(i)"))").foregroundStyle(Colors.text).padding(12).plainRow()
        }
        .appList()
        .readableWidth()
        .navigationTitle(t("howTo"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoRules") } }
    }
}

struct SocketsScreen: View {
    var body: some View {
        List {
            HStack { TableText(t("connected")); Spacer(); CheckOrCross(ok: Sync.shared.connected) }
            if let error = Sync.shared.connectionError {
                HStack { TableText(t("socketError")); Spacer(); TableText(error, color: Colors.text.opacity(0.6)) }
            }
        }
        .settingsList()
        .navigationTitle(t("socketsInfo"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoSockets") } }
    }
}

/// The RN app's data export; encrypted texts stay encrypted (the RN app sent them decrypted)
private func export(_ todo: Todo) -> [String: Any] {
    var json = TodoEntity.toJson(todo)
    if todo.encrypted, let key = Session.encryptionKey { json["text"] = Crypto.encrypt(todo.text, key) }
    return json
}

struct DataScreen: View {
    var body: some View {
        let db = Db.shared
        let counts = [db.count("todos", Db.UNDELETED), db.count("tags", Db.UNDELETED), db.delegators().count, db.delegates().count]
        List {
            Section(t("count")) {
                ForEach(Array(zip(["todoCount", "tagsCount", "delegate.delegators", "delegate.delegates"], counts)), id: \.0) {
                    ValueRow(title: t($0.0), value: "\($0.1)")
                }
            }
            Section(t("sync")) {
                ValueRow(title: t("settingsLastSync"), value: date(Settings.updatedAt))
                ValueRow(title: t("accountLastSync"), value: date(Session.user?.updatedAt))
                ValueRow(title: t("gamification"), value: date(Hero.updatedAt))
            }
            Section {
                TableItem(action: { Ui.attempt { try await Sync.shared.sync() } }) { TableText(t("syncData")) }
                TableItem(action: { Ui.attempt { try await Sync.shared.hardSync() } }) { TableText(t("syncDataHard")) }
                TableItem(action: Todos.recalculateExactDates) { TableText(t("syncExactDates")) }
                TableItem(action: sendDataToServer) { TableText(t("sendDataToServer")) }
            }
        }
        .settingsList()
        .navigationTitle(t("dataInfo"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoData") } }
    }

    private func date(_ millis: Int?) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return millis.map { f.string(from: Date(timeIntervalSince1970: Double($0) / 1000)) } ?? t("notSyncedYet")
    }

    private func sendDataToServer() {
        Task { @MainActor in
            let (todos, tags) = (Db.shared.todos(), Db.shared.tags())
            do { try await Rest.sendData(["todos": todos.map(export), "tags": tags.map(TagEntity.toJson)]) } catch { Ui.error(error) }
            // Re-push everything
            Db.shared.pushAgain(TodoEntity)
            Db.shared.pushAgain(TagEntity)
            Ui.toast("👍")
        }
    }
}

struct TagsScreen: View {
    var body: some View {
        let tags = Db.shared.undeletedTags()
        List {
            if !tags.isEmpty {
                Button {
                    Ui.alert(t("deleteAllHashtagsConfirm"), nil, [
                        (t("delete"), { Db.shared.save(TagEntity, Db.shared.undeletedTags().map { $0.deleted = true; return $0 }) }),
                        (t("cancel"), {}),
                    ])
                } label: { TableText(t("deleteAllHashtags"), color: Colors.destruct) }
                    .buttonStyle(.plain).padding(.horizontal, 16).padding(.vertical, 12).plainRow()
            } else {
                Text(t("emptyHashtags")).font(Fonts.text()).foregroundStyle(Colors.text).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(20).plainRow()
            }
            ForEach(tags, id: \.id) { tag in
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        Text("#\(tag.tag)").font(Fonts.text()).foregroundStyle(tag.color.flatMap { $0.isEmpty ? nil : hex($0) } ?? Colors.link)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        IconBtn(name: "target_outline_28", color: tag.epic ? .gray : nil, label: t("epic.intoEpic")) {
                            if tag.epic { unEpic(tag) } else { Nav.push(.addEpic(tag.id)) }
                        }
                        IconBtn(name: "edit_outline_28", label: t("editHashtag")) { Nav.push(.changeText(tag.id)) }
                        IconBtn(name: "delete_outline_28-iOS", color: Colors.destruct, label: t("delete")) {
                            Ui.confirm("\(t("deleteTodo")) \"#\(tag.tag.ellipsize(50))\"?", t("delete"), destructive: true) {
                                Db.shared.updateTag(tag) { $0.deleted = true }
                            }
                        }
                    }
                    .padding(.vertical, 8)
                    Divider(horizontal: 0)
                }
                .padding(.horizontal, 16).plainRow()
            }
        }
        .appList()
        .readableWidth()
        .navigationTitle(t("tags"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoTags") } }
    }

    private func unEpic(_ tag: Tag) {
        Ui.confirm("\(t("unEpicConfirm")) \"#\(tag.tag.ellipsize(50))\"?", t("unEpic")) {
            Db.shared.updateTag(tag) { $0.epicCompleted = false; $0.epicGoal = 0; $0.epicOrder = 0; $0.epicPoints = 0; $0.epic = false }
        }
    }
}

private struct TagTitle: View {
    let tag: Tag?
    let color: Color?
    var body: some View {
        Text("#\(tag?.tag ?? "")").font(.system(size: 32)).foregroundStyle(color ?? tag?.color.flatMap { $0.isEmpty ? nil : hex($0) } ?? Colors.link)
            .multilineTextAlignment(.center).frame(maxWidth: .infinity)
    }
}

struct ChangeTextScreen: View {
    let tagId: String
    @State private var newName = ""
    @State private var color: Color?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let tag = Db.shared.tag(tagId)
        let presets = scheme == .dark ? ["#FFBE3D", "#FF984C", "#FF715B", "#6cdaaf", "#32A4C6", "#70bfd7", "#23738b", "#ab81d6"]
            : ["#FFBE3D", "#FF984C", "#FF715B", "#2DCA8C", "#32A4C6", "#377DFF", "#4740D6", "#5603AD"]
        ScrollView {
            VStack(spacing: 20) {
                TagTitle(tag: tag, color: color)
                TextField(t("editName"), text: $newName).multilineTextAlignment(.center).font(Fonts.text(18))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .padding(.vertical, 8).overlay(alignment: .bottom) { Rectangle().fill(Colors.border).frame(height: 1) }
                    .padding(.horizontal, 16)
                HStack(spacing: 12) {
                    ForEach(presets, id: \.self) { c in
                        Button { color = hex(c) } label: { Circle().fill(hex(c)).frame(width: 26, height: 26) }.buttonStyle(.plain)
                    }
                    // The system color picker instead of the RN app's HSV square
                    ColorPicker("", selection: Binding(get: { color ?? tag?.color.flatMap { $0.isEmpty ? nil : hex($0) } ?? Colors.link }, set: { color = $0 }),
                                supportsOpacity: false).labelsHidden()
                }
            }
            .padding(.vertical, 24)
        }
        .background(Colors.background)
        .navigationTitle(t("editHashtag"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { if let tag { saveTagText(tag) } } label: { Image(systemName: "checkmark") }.accessibilityLabel(t("save"))
            }
        }
    }

    /// Renames a hashtag in all todos and recolors it
    private func saveTagText(_ tag: Tag) {
        let trimmed = newName.trimmingCharacters(in: .whitespaces)
        let name = trimmed.range(of: "^\\S+$", options: .regularExpression) != nil ? trimmed : nil
        if let name, name != tag.tag {
            // RN split words by spaces only, so tags next to line breaks weren't renamed
            let pattern = "(?<=^|\\s)#\(NSRegularExpression.escapedPattern(for: tag.tag))(?=\\s|$)"
            let todos = Db.shared.todos("\(Db.UNDELETED) AND text LIKE ?", ["%#\(tag.tag)%"]).filter { $0.text.range(of: pattern, options: .regularExpression) != nil }
            for todo in todos { todo.text = todo.text.replacingOccurrences(of: pattern, with: "#\(name)", options: .regularExpression) }
            Db.shared.saveTodos(todos)
        }
        Db.shared.updateTag(tag) {
            $0.tag = name ?? tag.tag
            if let color { $0.color = color.hexString }
        }
        Nav.back()
    }
}

struct AddEpicScreen: View {
    let tagId: String
    @State private var goal = ""

    var body: some View {
        let tag = Db.shared.tag(tagId)
        VStack(spacing: 20) {
            TagTitle(tag: tag, color: nil)
            TextField(t("epic.epicGoal"), text: Binding(get: { goal }, set: { goal = $0.filter(\.isNumber) }))
                .keyboardType(.numberPad).multilineTextAlignment(.center).font(Fonts.text(18)).foregroundStyle(Color(UIColor(rgb: 0x008000)))
                .padding(.vertical, 8).overlay(alignment: .bottom) { Rectangle().fill(Colors.border).frame(height: 1) }
                .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Colors.background)
        .navigationTitle(t("epic.intoEpic"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    guard let value = Int(goal), value > 0, let tag else { return }
                    Db.shared.updateTag(tag) { $0.epic = true; $0.epicGoal = value; $0.epicPoints = 0 }
                    Nav.back()
                } label: { Image(systemName: "checkmark") }.accessibilityLabel(t("save"))
            }
        }
    }
}

/// Google Calendar OAuth handoff between the integrations and the web view screens
private enum CalendarAuth {
    static var url = ""

    static func authorize(_ code: String) {
        AppState.shared.calendarLoading = true
        Ui.attempt({ AppState.shared.calendarLoading = false }) {
            let credentials = try await Rest.calendarAuthorize(code)
            Settings.googleCalendarCredentials = String(data: try JSONSerialization.data(withJSONObject: credentials), encoding: .utf8)
        }
    }
}

struct IntegrationsScreen: View {
    var body: some View {
        List {
            TableItem(action: { Ui.confirm(t("googleCalendarHint"), t("googleCalendarGotIt")) { googleCalendarTapped() } }) {
                TableText(t("googleCalendar"))
                Spacer()
                if AppState.shared.calendarLoading { ProgressView() } else {
                    TableText(t(Settings.googleCalendarCredentials != nil ? "connected" : "notConnected"), color: Colors.text.opacity(0.6))
                }
            }
            .settingsRow()
        }
        .settingsList()
        .navigationTitle(t("integrations"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoIntegrations") } }
    }

    private func googleCalendarTapped() {
        if Settings.googleCalendarCredentials != nil {
            return Ui.actionSheet(nil, [t("disconnect")], destructive: [0]) { _ in Settings.googleCalendarCredentials = nil }
        }
        AppState.shared.calendarLoading = true
        Ui.attempt({ AppState.shared.calendarLoading = false }) {
            CalendarAuth.url = try await Rest.calendarAuthenticationURL()
            Nav.push(.googleCalendar)
        }
    }
}

struct GoogleCalendarScreen: View {
    @State private var handled = false

    var body: some View {
        // Google refuses sign-in in web views that look like apps
        WebPageScreen(title: t("googleCalendar"), url: CalendarAuth.url, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1") { url in
            let code = url.host == "accounts.google.com" ? nil : URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "code" }?.value
            guard !handled, let code, !code.isEmpty else { return true }
            handled = true
            Nav.back()
            CalendarAuth.authorize(code)
            return false
        }
    }
}

struct SecurityScreen: View {
    @State private var encryptionOn = Session.encryptionKey != nil
    @State private var password = Session.encryptionKey ?? ""
    @State private var passwordRepeat = Session.encryptionKey ?? ""
    @State private var loading = false
    private let ownWhere = "\(Db.UNDELETED) AND delegator IS NULL AND encrypted = ?"

    var body: some View {
        let encryptedCount = Db.shared.count("todos", ownWhere, [true])
        let unencryptedCount = Db.shared.count("todos", ownWhere, [false])
        List {
            Section {
                TableText(t("infoSecurity"))
                Toggle(isOn: Binding(get: { encryptionOn }, set: { value in
                    if value { encryptionOn = true } else if Session.encryptionKey != nil {
                        Ui.confirm(t("encryptionDisableConfirm"), t("disable")) {
                            guard let key = Session.encryptionKey else { return }
                            Session.encryptionKey = nil
                            encryptionOn = false
                            encryptEncrypted(true, key)
                        }
                    } else { encryptionOn = false }
                })) { TableText(t("encryptTodo")) }
                if encryptionOn {
                    SecureField(t("password"), text: Binding(get: { password }, set: { if $0.count <= 35 { password = $0 } }))
                        .textContentType(.newPassword).accessibilityIdentifier("encryptionPassword")
                    SecureField(t("encryption.repeatPassword"), text: Binding(get: { passwordRepeat }, set: { if $0.count <= 35 { passwordRepeat = $0 } }))
                        .textContentType(.newPassword).accessibilityIdentifier("encryptionPasswordRepeat")
                    if !password.isEmpty && password != Session.encryptionKey && password == passwordRepeat {
                        PrimaryButton(text: t("save")) {
                            Ui.confirm(t("encryptionConfirm"), t("save")) {
                                let sample = Db.shared.todos(ownWhere, [true], limit: 1).first
                                if let sample, Crypto.decrypt(sample.text, password) == nil { return Ui.error(t("passwordError")) }
                                Session.encryptionKey = password
                                encryptEncrypted(false, password)
                                Ui.message(t("encryption.encryption"), t("encryption.encryptionSaved"))
                            }
                        }
                    }
                }
            }
            .settingsRow()
            Section(t("count")) {
                ValueRow(title: t("encryptedTodos"), value: "\(encryptedCount)")
                ValueRow(title: t("unencryptedTodos"), value: "\(unencryptedCount)")
            }
            .settingsRow()
            Section(t("general")) {
                if loading { ProgressView().frame(maxWidth: .infinity) }
                PrimaryButton(text: t("encryptAllButton"), enabled: Session.encryptionKey != nil && unencryptedCount > 0) {
                    Ui.confirm(t("confirmEncryptAll"), t("encryptAllButton")) { changeEncrypted(true) }
                }
                PrimaryButton(text: t("decryptAllButton"), enabled: Session.encryptionKey != nil && encryptedCount > 0) {
                    Ui.confirm(t("confirmDecryptAll"), t("decryptAllButton")) { changeEncrypted(false) }
                }
            }
            .listRowBackground(Color.clear)
        }
        .settingsList()
        .navigationTitle(t("security"))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Marks all own todos as (un)encrypted; they get pushed (encrypted) on sync
    private func changeEncrypted(_ encrypted: Bool) {
        let todos = Db.shared.todos(ownWhere, [!encrypted])
        todos.forEach { $0.encrypted = encrypted }
        Db.shared.saveTodos(todos)
    }

    /// Local texts of encrypted todos are kept decrypted while a key is set, and as ciphertext without one
    private func encryptEncrypted(_ encrypt: Bool, _ key: String) {
        let todos = Db.shared.todos(ownWhere, [true])
        Db.shared.write {
            // Local only. RN replaced texts that failed to decrypt with ""; keep them as they are instead
            for todo in todos {
                todo.text = encrypt ? Crypto.encrypt(todo.text, key) : Crypto.decrypt(todo.text, key) ?? todo.text
                Db.shared.writeLocal(TodoEntity, todo)
            }
        }
    }
}

struct DelegationUsersScreen: View {
    let delegators: Bool

    var body: some View {
        let me = Session.user?.id
        let users = (delegators ? Db.shared.delegators() : Db.shared.delegates()).filter { $0.id != me }
        List {
            if users.isEmpty { TableText(t(delegators ? "delegate.noDelegators" : "delegate.noDelegates")) }
            ForEach(users, id: \.self) { user in
                HStack {
                    TableText(user.name ?? "")
                    Spacer()
                    IconBtn(name: "delete_outline_28-iOS", color: Colors.destruct, label: t("delete")) {
                        Ui.confirm(t("delegate.deleteDelegatorConfirmation"), t("delete"), title: user.name, destructive: true) {
                            Ui.attempt { try await Todos.removeDelegation(user) }
                        }
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle(t(delegators ? "delegate.delegators" : "delegate.delegates"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
