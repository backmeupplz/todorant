import SwiftUI

/// A settings row: [title] on the left, optional value or control on the right, a chevron when it opens something
struct TableItem<Content: View>: View {
    var action: (() -> Void)? = nil
    @ViewBuilder let content: () -> Content

    var body: some View {
        if let action {
            Button(action: action) {
                HStack {
                    HStack { content() }.frame(maxWidth: .infinity, alignment: .leading)
                    TIcon(name: "chevron_right_outline_28", size: 24, color: Colors.border)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            HStack { content() }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct TableText: View {
    let text: String
    var color: Color = Colors.text

    init(_ text: String, color: Color = Colors.text) {
        self.text = text
        self.color = color
    }

    var body: some View { Text(text).font(Fonts.text()).foregroundStyle(color) }
}

/// Title on the left, value on the right
struct ValueRow: View {
    let title: String
    let value: String
    var action: (() -> Void)? = nil

    var body: some View {
        TableItem(action: action) {
            TableText(title)
            Spacer()
            TableText(value, color: Colors.text.opacity(0.6))
        }
    }
}

/// TextAndSwitch: [title] is a translation key
struct TextAndSwitch: View {
    let title: String
    let value: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { value }, set: onChange)) { TableText(t(title)) }.tint(Colors.primary)
    }
}

struct CheckOrCross: View {
    let ok: Bool
    var body: some View {
        Image(systemName: ok ? "checkmark" : "xmark").foregroundStyle(ok ? Colors.success : Colors.destruct)
            .accessibilityLabel(ok ? t("connected") : t("notConnected"))
    }
}

/// A settings list on the app background
extension View {
    func settingsList() -> some View {
        listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Colors.background).tint(Colors.primary)
    }

    func settingsRow() -> some View { listRowBackground(Colors.cardBackground) }
}

/// "HH:mm" setting with the system time picker; [value] nil shows [placeholder] until tapped
struct TimeSetting: View {
    let title: String
    let value: String?
    let placeholder: String
    var showClear = true
    let onClear: () -> Void
    let onSet: (String) -> Void

    var body: some View {
        HStack {
            TableText(t(title))
            Spacer()
            if let value, let (h, m) = parseTime(value) {
                DatePicker("", selection: Binding(get: { calendar.date(bySettingHour: h, minute: m, second: 0, of: Date())! }, set: { d in
                    let c = calendar.dateComponents([.hour, .minute], from: d)
                    onSet(hhmm(c.hour!, c.minute!))
                }), displayedComponents: .hourAndMinute).labelsHidden()
                if showClear {
                    Button(action: onClear) { Image(systemName: "xmark").foregroundStyle(Colors.border) }.buttonStyle(.plain).accessibilityLabel(t("cancel"))
                }
            } else {
                Button(placeholder) {
                    let c = calendar.dateComponents([.hour, .minute], from: Date())
                    onSet(hhmm(c.hour!, c.minute!))
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

private let languageNames: [(String, String)] = [
    ("en", "English"), ("ru", "Русский"), ("uk", "Українська"), ("it", "Italiano"), ("es", "Español"), ("pt-br", "Português Brasileiro"),
]

struct SettingsScreen: View {
    var body: some View {
        let user = Session.user
        ScrollViewReader { proxy in
            List {
                Section(t("important")) {
                    TableItem(action: { Nav.push(.rules) }) { TableText(t("howToUse")) }
                        .onboardingTarget(OnboardingTarget.howToUse).id(OnboardingTarget.howToUse)
                }
                .settingsRow()
                Section(t("account")) {
                    AccountInfo()
                    ServerSetting()
                }
                .settingsRow()
                Section {
                    if user != nil {
                        PrimaryButton(text: t("logout")) { Ui.confirm(t("logoutText"), t("logout")) { Account.logout() } }
                    } else {
                        PrimaryButton(text: t("loginButton")) { Nav.push(.login) }
                    }
                } footer: {
                    if user == nil { Text(t("alreadyRegistered")).font(Fonts.text(15)) }
                }
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                Section(t("todos")) { TodoSettings() }.settingsRow()
                if user != nil { Section(t("delegate.title")) { DelegationSettings() }.settingsRow() }
                Section(t("general")) {
                    if user != nil {
                        TableItem(action: { Nav.push(.sockets) }) { TableText(t("socketsInfo")); Spacer(); CheckOrCross(ok: Sync.shared.connected) }
                        TableItem(action: { Nav.push(.data) }) { TableText(t("dataInfo")) }
                    }
                    LanguageAndColorMode()
                    GeneralSwitches()
                }
                .settingsRow()
                Section(t("info")) {
                    TableItem(action: {
                        Onboarding.tutorialIsShown = false
                        Onboarding.nextStep(.Start)
                    }) { TableText(t("tutorialButton")) }
                    TableItem(action: { Nav.push(.terms) }) { TableText(t("termsOfUse")) }
                    TableItem(action: { Nav.push(.privacy) }) { TableText(t("privacyPolicy")) }
                    TableItem(action: Ui.support) { TableText(t("supportLabel")) }
                        .onboardingTarget(OnboardingTarget.supportButton).id(OnboardingTarget.supportButton)
                }
                .settingsRow()
                Section {
                    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
                    #if DEBUG
                    TableText("v\(version).dev")
                    #else
                    TableText("v\(version)")
                    #endif
                }
                .settingsRow()
            }
            .settingsList()
            .readableWidth()
            .onAppear {
                Onboarding.shared.scrollToTarget = { id in withAnimation { proxy.scrollTo(id, anchor: .top) } }
            }
        }
        .navigationTitle(t("settings"))
        .largeTitleOnPhone()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if Sync.shared.isSyncing { ProgressView() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                InfoButton(message: "infoSettings").onboardingTarget(OnboardingTarget.infoButton)
            }
        }
        .task { if Sync.shared.connected { do { try await Sync.shared.sync() } catch { Ui.error(error) } } }
    }
}

private struct InfoRow: View {
    let title: String
    let value: String

    var body: some View {
        TableItem(action: { Ui.copy(value) }) {
            TableText(title)
            Spacer()
            TableText(value.ellipsize(30), color: Colors.text.opacity(0.6)).lineLimit(1)
        }
    }
}

private struct AccountInfo: View {
    @State private var loading = false
    @State private var editing = false
    @State private var name = ""
    @State private var scanning = false

    var body: some View {
        if let user = Session.user {
            if loading { ProgressView().frame(maxWidth: .infinity) }
            let shown = Session.name.isEmpty ? user.name : Session.name
            if !editing {
                TableItem(action: { name = shown; editing = true }) {
                    TableText(t("nameLabel"))
                    Spacer()
                    TableText(shown.count <= 20 ? shown : "\(shown.prefix(20))...", color: Colors.text.opacity(0.6))
                }
            } else {
                HStack {
                    TextField(t("nameLabel"), text: $name, axis: .vertical).font(Fonts.text(18))
                    Button { editing = false } label: { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundStyle(Colors.border)
                    if !name.trimmingCharacters(in: .whitespaces).isEmpty && name != shown {
                        Button {
                            editing = false
                            // Synced like any edit; the RN app kept showing the old name until the next full sync
                            Session.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        } label: { Image(systemName: "checkmark") }.buttonStyle(.plain).foregroundStyle(Colors.primary)
                    }
                }
            }
            if let v = user.email { InfoRow(title: t("email"), value: v) }
            if let v = user.facebookId { InfoRow(title: t("facebook"), value: v) }
            if let v = user.telegramId { InfoRow(title: t("telegram"), value: v) }
            if let v = user.appleSubId { InfoRow(title: t("apple"), value: v) }
            if let v = user.passwordLogin { InfoRow(title: t("email"), value: v) }
            TableItem(action: { scanning = true }) { TableText(t("addDevices")) }
                .qrScanner(isPresented: $scanning) { uuid in
                    // The scanned page gets this account's token: a QR shown by someone else would hand it to them
                    Ui.confirm(t("addDevicesConfirm"), t("addDevices")) {
                        loading = true
                        Ui.attempt({ loading = false }) { try await Rest.setQrToken(uuid) }
                    }
                }
            Button {
                Ui.confirm(t("deleteAccountText"), t("deleteAccount"), destructive: true) {
                    loading = true
                    Ui.attempt({ loading = false }) {
                        try await Rest.deleteAccount()
                        Account.logout()
                    }
                }
            } label: { TableText(t("deleteAccount"), color: Colors.destruct) }
                .buttonStyle(.plain)
        } else {
            TableText(t("anonymousText"))
        }
    }
}

/// The server: shows its address and opens an editor; empty means todorant's own
struct ServerSetting: View {
    var link = false
    @State private var draft: String?

    var body: some View {
        if let value = draft {
            HStack {
                TextField(Rest.API.replacingOccurrences(of: "^[a-z]+://", with: "", options: .regularExpression), text: Binding(get: { value }, set: { draft = $0 }))
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().font(Fonts.text(18))
                    .accessibilityIdentifier("serverField")
                Button { draft = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundStyle(Colors.border)
                Button { Account.changeServer(value) { draft = nil } } label: { Image(systemName: "checkmark") }
                    .buttonStyle(.plain).foregroundStyle(Colors.primary).accessibilityLabel(t("save"))
            }
        } else {
            let address = Rest.base.replacingOccurrences(of: "^[a-z]+://", with: "", options: .regularExpression)
            if link {
                Button("\(t("server")): \(address)") { draft = Rest.base }.font(Fonts.text(14)).foregroundStyle(Colors.link).frame(maxWidth: .infinity)
            } else {
                ValueRow(title: t("server"), value: address.ellipsize(30)) { draft = Rest.base }
            }
        }
    }
}

private struct TodoSettings: View {
    var body: some View {
        TextAndSwitch(title: "defaultToToday", value: Settings.showTodayOnAddTodo == true) { Settings.showTodayOnAddTodo = $0 }
        TextAndSwitch(title: "newTodosGoOnTop", value: Settings.newTodosGoFirst == true) { Settings.newTodosGoFirst = $0 }
        TextAndSwitch(title: "preserveOrderByTime", value: Settings.preserveOrderByTime == true) { Settings.preserveOrderByTime = $0 }
        // Local only, the RN app needlessly bumped the settings version for it
        TextAndSwitch(title: "askBeforeDelete", value: Settings.askBeforeDelete) { Settings.askBeforeDelete = $0 }
        TextAndSwitch(title: "settingsObject.duplicateTagInBreakdown", value: Settings.duplicateTagInBreakdown == true) { Settings.duplicateTagInBreakdown = $0 }
        TextAndSwitch(title: "settingsObject.showMoreByDefault", value: Settings.showMoreByDefault == true) { Settings.showMoreByDefault = $0 }
        Picker(selection: Binding(get: { Settings.firstDayOfWeekSafe }, set: { Settings.firstDayOfWeek = $0 })) {
            ForEach(0..<7, id: \.self) { Text(t("weekday\($0)")).tag($0) }
        } label: { TableText(t("firstDayOfWeek")) }
        TimeSetting(title: "startTimeOfDay", value: Settings.startTimeOfDaySafe, placeholder: "", showClear: Settings.startTimeOfDaySafe != "00:00",
                    onClear: { Settings.startTimeOfDay = "00:00" }) { Settings.startTimeOfDay = $0 }
        TimeSetting(title: "planningReminderTime", value: Settings.planningReminderTime, placeholder: t("notSet"), onClear: {
            Settings.planningReminderTime = nil
            Reminders.stop()
        }) { time in
            Settings.planningReminderTime = time
            Reminders.schedule(time)
            Task { _ = await Reminders.requestPermission() }
        }
        TableItem(action: { Nav.push(.tags) }) { TableText(t("tags")) }
    }
}

private struct DelegationSettings: View {
    var body: some View {
        TableItem(action: { Ui.copy(Session.delegateInviteLink) }) {
            VStack(alignment: .leading) {
                TableText(t("delegate.link"))
                Text("\(Session.delegateInviteLink.prefix(30))...").foregroundStyle(Colors.text).lineLimit(1).opacity(0.4)
            }
            Spacer()
            Button {
                Ui.actionSheet(t("delegate.resetConfirmation"), [t("delegate.resetLink")]) { _ in
                    Ui.attempt {
                        let inviteToken = try await Rest.resetDelegateToken()
                        if let u = Session.user { Session.setUser(u.with("delegateInviteToken", inviteToken)) }
                    }
                }
            } label: { Image(systemName: "arrow.clockwise").foregroundStyle(Colors.border) }
                .buttonStyle(.plain).accessibilityLabel(t("delegate.resetLink"))
        }
        TableItem(action: { Nav.push(.delegators) }) { TableText(t("delegate.delegators")) }
        TableItem(action: { Nav.push(.delegates) }) { TableText(t("delegate.delegates")) }
    }
}

private struct LanguageAndColorMode: View {
    var body: some View {
        Picker(selection: Binding(get: { Settings.languageSelect == "auto" || Settings.languageSelect == nil ? "auto" : Settings.language ?? "en" }, set: { code in
            Settings.languageSelect = code
            // The RN app only applied "auto" after a restart
            Settings.language = code == "auto" ? I18n.languageTag() : code
            Reminders.restore()
        })) {
            Text(t("languageAuto")).tag("auto")
            ForEach(languageNames, id: \.0) { Text($0.1).tag($0.0) }
        } label: { TableText(t("languageSelect")) }
        let modes: [(ColorMode, String)] = [(.auto, "languageAuto"), (.dark, "dark"), (.light, "light")]
        Picker(selection: Binding(get: { Settings.colorMode }, set: { Settings.colorMode = $0 })) {
            ForEach(modes, id: \.0) { Text(t($0.1)).tag($0.0) }
        } label: { TableText(t("colorMode")) }
    }
}

private struct GeneralSwitches: View {
    var body: some View {
        if Session.user != nil { TableItem(action: { Nav.push(.security) }) { TableText(t("security")) } }
        TextAndSwitch(title: "soundEffects", value: Settings.soundOn) { Settings.soundOn = $0 }
        if !Settings.soundOn { TextAndSwitch(title: "endOfDaySoundOn", value: Settings.endOfDaySoundOn) { Settings.endOfDaySoundOn = $0 } }
        TextAndSwitch(title: "gamification", value: Settings.gamificationOn) { Settings.gamificationOn = $0 }
        TextAndSwitch(title: "badgeIconCurrentCount", value: Settings.badgeIconCurrentCount) { on in
            Settings.badgeIconCurrentCount = on
            Task {
                if on { _ = await Reminders.requestPermission() }
                Widget.refresh()
            }
        }
        TextAndSwitch(title: "settingsActions.swipeActions", value: Settings.swipeActions) { Settings.swipeActions = $0 }
    }
}
