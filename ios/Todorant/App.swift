import Observation
import SwiftUI
import UserNotifications

@main
struct TodorantApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        Db.shared.open()
        Db.onWrite = Widget.refresh
        I18n.start()
        Sync.shared.start()
        Migration.run()
        Reminders.restore()
        #if DEBUG
        QA.apply()
        #endif
    }

    var body: some Scene {
        WindowGroup { RootView() }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// The planning reminder shows while the app is open too
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

/// Today's title, following the "start time of day" setting (ObservableNow in the RN app)
@Observable
final class Clock {
    static let shared = Clock()
    private(set) var today = todayTitle()
    @ObservationIgnored private var timer: Timer?

    private init() {
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            let today = todayTitle()
            if self?.today != today { self?.today = today }
        }
    }
}

/// Narrowest window that gets the add screen as a column next to the tabs: an unfolded iPhone Duo (669 pt) or any iPad
private let INLINE_EDITOR_MIN_WIDTH: CGFloat = 600
/// The column takes half the window up to this width, so on the Duo it ends at the hinge in the middle
private let INLINE_EDITOR_MAX_WIDTH: CGFloat = 440

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var systemScheme
    @Environment(\.horizontalSizeClass) private var systemSizeClass
    @State private var width: CGFloat = 0
    private var nav: Nav { Nav.shared }
    private var layoutDirection: LayoutDirection { I18n.rtl ? .rightToLeft : .leftToRight }

    private var sizeClass: UserInterfaceSizeClass? {
        #if DEBUG
        if let forced = QA.Layout.shared.sizeClass { return forced }
        #endif
        return systemSizeClass
    }

    var body: some View {
        let _ = Clock.shared.today
        let planningRequired = Todos.oldCount() > 0 && !Onboarding.active
        let delegatedToMe = Session.user == nil ? 0 : Todos.delegated(byMe: false).count
        // Android shows only Settings during the first sync; here the login screen covers it with a progress overlay
        let tabs: [Tab] = planningRequired ? [.planning, .delegation, .settings] : [.current, .planning, .delegation, .settings]
        // Wide regular width (unfolded, iPad) edits next to the list; the tutorial always uses the sheet it was written for
        let inline = sizeClass == .regular && width >= INLINE_EDITOR_MIN_WIDTH && !Onboarding.active
        // The tabs stay the first view whether or not the column shows, so folding never rebuilds them
        HStack(spacing: 0) {
            GeometryReader { window in
                TabView(selection: Binding(get: { nav.tab }, set: { if !Onboarding.active { nav.tab = $0 } })) {
                    if tabs.contains(.current) { tab(.current, t("current"), "tab_current") { CurrentScreen() } }
                    if tabs.contains(.planning) { tab(.planning, t("planning"), "tab_planning") { PlanningScreen() } }
                    if tabs.contains(.delegation) {
                        tab(.delegation, t("delegate.title"), "tab_delegation") { DelegationScreen() }.badge(delegatedToMe)
                    }
                    tab(.settings, t("settings"), "tab_settings") { SettingsScreen() }.badge(Session.user == nil ? Text("!") : nil)
                }
                .onAppear { registerTabTargets(window, tabs) }
                .onChange(of: window.size) { registerTabTargets(window, tabs) }
                .onChange(of: tabs) { _, tabs in
                    registerTabTargets(window, tabs)
                    if !tabs.contains(nav.tab) { nav.tab = tabs[0] }
                }
            }
            .ignoresSafeArea(.keyboard)
            if nav.editorInline, let draft = nav.draft {
                Rectangle().fill(Colors.border).frame(width: 1).ignoresSafeArea()
                // TODO(#212): on iOS 27.1, UIView.reservedRegions(kind: .division) gives the hinge; the half-width column already ends there
                AddTodoScreen(draft: draft, inline: true)
                    .frame(width: min(width / 2, INLINE_EDITOR_MAX_WIDTH))
                    .id(ObjectIdentifier(draft))
                    .transition(.move(edge: .trailing))
            }
        }
        // The column's form keeps clear of the keyboard; everything else ignores it as before
        .ignoresSafeArea(nav.editorInline ? [] : .keyboard)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: inline, initial: true) { _, inline in nav.editorInline = inline }
        .environment(\.horizontalSizeClass, sizeClass)
        .overlay { EffectsLayer() }
        .overlay { if nav.sheet == nil || nav.editorInline { OnboardingOverlay() } }
        .modifier(DialogHost(active: nav.sheet == nil || nav.editorInline))
        // Read live in the setter too: a sheet closed because the screen moved to the column must not end the edit.
        // Presented by its draft, so the closing sheet keeps showing the form while it slides away.
        .sheet(item: Binding(get: { nav.editorInline ? nil : nav.draft }, set: { if !nav.editorInline && $0 == nil { Nav.closeEditor() } })) { draft in
            AddTodoScreen(draft: draft)
                .modifier(PageSizedSheet())
                .overlay { OnboardingOverlay() }
                .modifier(DialogHost())
                .preferredColorScheme(colorScheme)
                .environment(\.layoutDirection, layoutDirection)
        }
        .tint(Colors.primary)
        // The in-app language can differ from the system one, so the layout direction follows it, not the system
        .environment(\.layoutDirection, layoutDirection)
        .preferredColorScheme(colorScheme)
        .onAppear { Settings.systemDark = systemScheme == .dark; Onboarding.restore() }
        .onChange(of: systemScheme) { _, s in Settings.systemDark = s == .dark }
        .onChange(of: scenePhase) { _, phase in
            // AppState change → globalSync in the RN app
            if phase == .active {
                Db.shared.touch()
                Sync.shared.reconnect()
                Sync.shared.request()
                RatingPrompt.appOpened()
            }
        }
        .onOpenURL(perform: handleUrl)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in activity.webpageURL.map(handleUrl) }
    }

    private var colorScheme: ColorScheme? {
        switch Settings.colorMode {
        case .auto: nil
        case .dark: .dark
        case .light: .light
        }
    }

    private func tab<Content: View>(_ tab: Tab, _ title: String, _ icon: String, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack(path: Binding(get: { nav.paths[tab] ?? [] }, set: { nav.paths[tab] = $0 })) {
            content().navigationDestination(for: Route.self) { RouteScreen(route: $0) }
        }
        .tabItem {
            Label { Text(title) } icon: { Image(nav.tab == tab ? "\(icon)_active" : icon).renderingMode(.original) }
        }
        .tag(tab)
    }

    /// The tab bar isn't a SwiftUI view: its items' frames for the tutorial are estimated
    private func registerTabTargets(_ window: GeometryProxy, _ tabs: [Tab]) {
        let frame = window.frame(in: .global)
        let height: CGFloat = 49
        let width = frame.width / CGFloat(tabs.count)
        for (tab, id) in [(Tab.planning, OnboardingTarget.tabPlanning), (Tab.settings, OnboardingTarget.tabSettings)] {
            guard let i = tabs.firstIndex(of: tab) else { continue }
            Onboarding.shared.targets[id] = CGRect(x: frame.minX + width * CGFloat(i), y: frame.maxY - height, width: width, height: height)
        }
    }
}

/// iPad's default form sheet is too short for the add screen's calendar
private struct PageSizedSheet: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 18, *) { content.presentationSizing(.page) } else { content }
    }
}

/// Pushed screens
struct RouteScreen: View {
    let route: Route

    var body: some View {
        switch route {
        case .login: LoginScreen()
        case .terms: WebPageScreen(title: t("termsOfUse"), url: "https://todorant.com/terms")
        case .privacy: WebPageScreen(title: t("privacyPolicy"), url: "https://todorant.com/privacy")
        case .telegram: TelegramLoginScreen()
        case .hero: HeroScreen()
        case .rules: RulesScreen()
        case .sockets: SocketsScreen()
        case .data: DataScreen()
        case .tags: TagsScreen()
        case let .addEpic(id): AddEpicScreen(tagId: id)
        case let .changeText(id): ChangeTextScreen(tagId: id)
        case .security: SecurityScreen()
        case .delegators: DelegationUsersScreen(delegators: true)
        case .delegates: DelegationUsersScreen(delegators: false)
        }
    }
}

/// todorant:// links and invite links
private func handleUrl(_ url: URL) {
    let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
    func query(_ name: String) -> String? { c?.queryItems?.first { $0.name == name }?.value }
    #if DEBUG
    if url.scheme == "todorant" && url.host == "qa-size-class" { return QA.overrideSizeClass(query("value")) }
    #endif
    if url.scheme == "todorant" && url.host == "create-todo" {
        let text = query("articleBody") ?? ""
        if text.isEmpty { Nav.go(.add()) } else { addTodoFromLink(text) }
    } else if url.scheme == "todorant" && url.host == "search", let q = query("query") {
        Nav.go(.planning)
        AppState.shared.searchEnabled = true
        AppState.shared.searchQuery = q
    } else if url.host == "todorant.com", url.pathComponents.count > 2, url.pathComponents[1] == "invite" {
        let token = url.pathComponents[2]
        Ui.confirm(t("delegate.inviteConfirm"), t("ok")) {
            if Session.user?.token == nil { return Ui.error(t("pleaseLogin")) }
            Sync.shared.acceptInvite(token)
        }
    }
}

/// todorant://create-todo?articleBody= (Shortcuts, Siri): adds right away when new todos default to today
private func addTodoFromLink(_ text: String) {
    if Settings.showTodayOnAddTodo != true { return Nav.go(.add(text: text)) }
    let today = Date()
    let todo = Todo(text: text, monthAndYear: today.monthAndYear, date: today.day, encrypted: Session.encryptionKey != nil)
    Db.shared.saveTodos([todo])
    let newFirst = Settings.newTodosGoFirst == true
    Todos.fixOrder([todo.title], addTodosOnTop: newFirst ? [todo] : [], addTodosToBottom: newFirst ? [] : [todo])
    Ui.toast("\(t("addedTask")): \(text)")
}

#if DEBUG
/// QA launch arguments (debug builds only): -qaToken <token> signs in, -qaSkipTutorial YES, -qaLanguage ru, -qaColorMode dark,
/// -qaSizeClass compact
enum QA {
    static func apply() {
        let args = UserDefaults.standard
        // QA runs pick their server with -API; a server switched to in an earlier run doesn't stick
        if args.string(forKey: "API") != nil { Rest.server = nil }
        if args.bool(forKey: "qaSkipTutorial") { Onboarding.tutorialIsShown = true }
        overrideSizeClass(args.string(forKey: "qaSizeClass"))
        if let lang = args.string(forKey: "qaLanguage") { Settings.languageSelect = lang; Settings.language = lang }
        if let mode = args.string(forKey: "qaColorMode").flatMap(ColorMode.init(rawValue:)) { Settings.colorMode = mode }
        if let token = args.string(forKey: "qaToken"), Session.user?.token != token {
            if Session.user != nil { Account.logout() }
            Task { @MainActor in
                do { try await Account.login(try await Rest.loginToken(token)) } catch { Ui.error(error) }
            }
        }
    }

    /// The horizontal size class the layout uses instead of the system's: a fold or unfold on any simulator
    @Observable
    final class Layout {
        static let shared = Layout()
        var sizeClass: UserInterfaceSizeClass?
    }

    /// compact, regular, or anything else for the system's; also todorant://qa-size-class?value= while running
    static func overrideSizeClass(_ value: String?) {
        Layout.shared.sizeClass = value == "compact" ? .compact : value == "regular" ? .regular : nil
    }
}
#endif
