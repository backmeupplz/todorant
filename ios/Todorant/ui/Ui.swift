import AVFoundation
import Observation
import SwiftUI
import UIKit

/// One alert or action sheet. Buttons run after the dialog closes.
struct DialogSpec: Identifiable {
    let id = UUID()
    let title: String?
    let message: String?
    let buttons: [(String, () -> Void)]
    var destructive: Set<Int> = []
    /// Action sheets (confirmation dialogs) can be dismissed by tapping outside; alerts need a button
    var sheet = false
}

/// Alerts, action sheets and toasts — Alert.alert / ActionSheet / Toast from the RN app
@Observable
final class Ui {
    static let shared = Ui()
    var dialogs = [DialogSpec]()
    var toastText: String?
    @ObservationIgnored private var toastWork: DispatchWorkItem?

    private static func show(_ spec: DialogSpec) { DispatchQueue.main.async { shared.dialogs.append(spec) } }

    static func alert(_ title: String?, _ message: String?, _ buttons: [(String, () -> Void)] = [(t("ok"), {})]) {
        show(DialogSpec(title: title, message: message, buttons: buttons))
    }

    static func message(_ title: String, _ message: String, ok: @escaping () -> Void = {}) { alert(title, message, [(t("ok"), ok)]) }

    static func error(_ e: Error) { error(e.localizedDescription) }

    static func error(_ error: String) { alert(t("error"), error) }

    /// Runs [block]; a failure shows up as an error alert
    static func attempt(_ finally: @escaping () -> Void = {}, _ block: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do { try await block() } catch { Ui.error(error) }
            finally()
        }
    }

    static func confirm(_ message: String, _ confirmText: String, title: String? = nil, destructive: Bool = false, _ onConfirm: @escaping () -> Void) {
        show(DialogSpec(title: title ?? t("pleaseConfirm"), message: message, buttons: [(t("cancel"), {}), (confirmText, onConfirm)],
                        destructive: destructive ? [1] : []))
    }

    /// Options plus a cancel button; [onPick] gets the option index
    static func actionSheet(_ title: String?, _ options: [String], destructive: Set<Int> = [], _ onPick: @escaping (Int) -> Void) {
        show(DialogSpec(title: title.flatMap { $0.isEmpty ? nil : $0 }, message: nil,
                        buttons: options.enumerated().map { i, o in (o, { onPick(i) }) }, destructive: destructive, sheet: true))
    }

    static func toast(_ text: String) {
        DispatchQueue.main.async {
            shared.toastText = text
            shared.toastWork?.cancel()
            let work = DispatchWorkItem { shared.toastText = nil }
            shared.toastWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
        }
    }

    static func support() {
        alert(t("supportLabel"), t("supportText"), [
            (t("cancel"), {}),
            ("n@borodutch.com", { openUrl("mailto:n@borodutch.com") }),
            ("@borodutch", { openUrl("https://t.me/borodutch") }),
        ])
    }

    static func info(_ message: String) { alert(t("infoTitle"), t(message), [(t("supportLabel"), { support() }), (t("ok"), {})]) }

    static func openUrl(_ url: String) { URL(string: url).map { UIApplication.shared.open($0) } }

    static func copy(_ text: String, toast: String? = nil) {
        UIPasteboard.general.string = text
        Ui.toast(toast ?? "\"\(text)\" \(t("copied"))")
    }
}

/// Shows the first queued dialog and toasts; [active] is false while a sheet above shows them instead
struct DialogHost: ViewModifier {
    var active = true
    private var ui: Ui { Ui.shared }

    private var current: DialogSpec? { active ? ui.dialogs.first : nil }

    private func binding(sheet: Bool) -> Binding<Bool> {
        Binding(get: { current.map { $0.sheet == sheet } ?? false }, set: { shown in
            if !shown, let spec = current, spec.sheet == sheet { ui.dialogs.removeAll { $0.id == spec.id } }
        })
    }

    private func close(_ spec: DialogSpec, _ action: @escaping () -> Void) {
        ui.dialogs.removeAll { $0.id == spec.id }
        // After the dialog is gone, so the action can show the next one
        DispatchQueue.main.async(execute: action)
    }

    @ViewBuilder
    private func buttons(_ spec: DialogSpec?) -> some View {
        if let spec {
            ForEach(Array(spec.buttons.enumerated()), id: \.offset) { i, button in
                let role: ButtonRole? = spec.destructive.contains(i) ? .destructive : button.0 == t("cancel") ? .cancel : nil
                Button(button.0, role: role) { close(spec, button.1) }
            }
        }
    }

    func body(content: Content) -> some View {
        let spec = current
        content
            .alert(spec?.title ?? "", isPresented: binding(sheet: false), presenting: spec) { s in buttons(s) } message: { s in
                if let m = s.message { Text(m) }
            }
            .confirmationDialog(spec?.title ?? "", isPresented: binding(sheet: true), titleVisibility: spec?.title == nil ? .hidden : .visible, presenting: spec) { s in
                buttons(s)
                if !s.buttons.contains(where: { $0.0 == t("cancel") }) { Button(t("cancel"), role: .cancel) {} }
            } message: { s in
                if let m = s.message { Text(m) }
            }
            .overlay(alignment: .bottom) {
                if active, let text = ui.toastText {
                    Text(text).font(Fonts.text(15)).foregroundStyle(.white).multilineTextAlignment(.center)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Color.black.opacity(0.8), in: Capsule())
                        .padding(.bottom, 100).padding(.horizontal, 24)
                        .transition(.opacity).allowsHitTesting(false)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: ui.toastText)
    }
}

// region Navigation

enum Tab: Hashable { case current, planning, delegation, settings }

/// Screens pushed onto a tab's stack
enum Route: Hashable {
    case login, terms, privacy, telegram, hero, rules, sockets, data, tags, security, delegators, delegates
    case addEpic(String), changeText(String)
}

/// The add, edit and breakdown screens, shown as a sheet above everything
enum Sheet: Identifiable, Hashable {
    case add(date: String? = nil, text: String? = nil)
    case edit(String)
    case breakdown(String)

    var id: Self { self }
}

@Observable
final class Nav {
    static let shared = Nav()
    var tab = Tab.current
    var paths: [Tab: [Route]] = [:]
    var sheet: Sheet?

    /// Tabs close pushed screens and sheets first, like RN's root stack
    static func go(_ tab: Tab) {
        shared.sheet = nil
        shared.paths[tab] = []
        shared.tab = tab
    }

    static func go(_ sheet: Sheet) {
        if shared.sheet == nil { return shared.sheet = sheet }
        // One sheet at a time: the old one has to be gone before the new one shows
        shared.sheet = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { shared.sheet = sheet }
    }

    static func push(_ route: Route) { shared.paths[shared.tab, default: []].append(route) }

    static func back() {
        if shared.sheet != nil { shared.sheet = nil } else if !(shared.paths[shared.tab] ?? []).isEmpty { shared.paths[shared.tab]!.removeLast() }
    }
}

// endregion

/// Confetti and the "mission passed" overlay
@Observable
final class Effects {
    static let shared = Effects()
    var confettiKey = 0
    var dayCompleteKey = 0
    @ObservationIgnored private var confettiStarted = Date.distantPast

    /// Shows confetti one time in five, or always with [force]
    static func confetti(force: Bool = false) {
        if !force && Int.random(in: 0..<5) != 0 { return }
        // Ignored while the previous burst is still falling, like RN
        if !force && Date().timeIntervalSince(shared.confettiStarted) < 2 { return }
        shared.confettiStarted = Date()
        shared.confettiKey += 1
    }

    static func dayComplete() { shared.dayCompleteKey += 1 }
}

enum Sounds {
    private static let players: [String: AVAudioPlayer] = {
        // Ambient: mixes with music and respects the silent switch
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
        var players = [String: AVAudioPlayer]()
        for name in ["level_up", "nice", "task_done", "day_complete"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "mp3"), let p = try? AVAudioPlayer(contentsOf: url) {
                p.prepareToPlay()
                players[name] = p
            }
        }
        return players
    }()

    private static func play(_ name: String) {
        if !Settings.soundOn && !Settings.endOfDaySoundOn { return }
        players[name]?.currentTime = 0
        players[name]?.play()
    }

    static func frogComplete() { play(Int.random(in: 0..<10) == 0 ? "nice" : "level_up") }
    static func taskComplete() { play("task_done") }
    static func dayComplete() { play("day_complete") }
}
