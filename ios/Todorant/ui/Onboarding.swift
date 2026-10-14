import Observation
import SwiftUI

/// Same order as the RN TutorialStep enum: nextStep() without an argument goes to the following one
enum TutorialStep: Int, CaseIterable {
    case SelectDateNotAllowed, BreakdownCompletedTodo, BreakdownLessThanTwo, AddTextContinueTooFast, AddTextContinueButton,
         Finished, Close, Start, Explain, AddTask, AddText, SelectDate, SelectFrog, SelectCompleted, ShowMore, AddAnotherTask,
         AddTodoComplete, ExplainCurrent, DeleteEditComplete, Breakdown, BreakdownTodo, BreakdownTodoAction, BreakdownVanish,
         PlanningExplain, PlanningExplain2, ExplainHashtags, ExplainSearchAndCompleted, ExplainReccuring, ExplainSettings,
         ExplainNotifications, ExplainMultiplatform, ExplainPricing, Feedback, Rules, Info, Congratulations

    var name: String { String(describing: self) }
    /// Translation key: the RN enum value differs from its name for one step
    var key: String { self == .BreakdownCompletedTodo ? "BreakDownCompletedTodo" : name }
}

/// Ids of UI elements the tutorial highlights; screens tag them with [onboardingTarget]
enum OnboardingTarget {
    static let plusButton = "plusButton"
    static let textRow = "textRow"
    static let dateRow = "dateRow"
    static let frogRow = "frogRow"
    static let completedRow = "completedRow"
    static let showMoreRow = "showMoreRow"
    static let addButton = "addButton"
    static let saveButton = "saveButton"
    static let currentTodo = "currentTodo"
    static let todoActions = "todoActions"
    static let breakdownButton = "breakdownButton"
    static let breakdownTodo = "breakdownTodo"
    static let tabPlanning = "tabPlanning"
    static let tabSettings = "tabSettings"
    static let planningSegment = "planningSegment"
    static let supportButton = "supportButton"
    static let howToUse = "howToUse"
    static let infoButton = "infoButton"
}

/// A message box button; [message] is a key under onboarding.<step>, [notAllowed] shows "Got it!"
struct OnboardingButton {
    var message: String? = nil
    var preferred = false
    var notAllowed = false
    let action: () -> Void
}

/// Step object from the RN AllStages. Hole sizing follows buildRnHole.
struct Step {
    var target: String? = nil
    var buttons: [OnboardingButton] = []
    var center = false
    var notShowContinue = false
    var notShowClose = false
    var notShowMessage = false
    var dontSave = false
    var customContinueText = false
    var divider: CGFloat = 2
    var borderRadius: CGFloat = 128
    var heightMultiplier: CGFloat = 1
    /// Screen to switch to (changeSavedSreen): "current", "planning", "settings" or "add"
    var screen: String? = nil
    /// Settings list has to scroll to the target first
    var scroll = false
}

/// OnboardingStore: the interactive tutorial shown until [tutorialIsShown]
@Observable
final class Onboarding {
    static let shared = Onboarding()

    static var tutorialIsShown: Bool {
        get { Prefs.bool("tutorialIsShown", false) }
        set { Prefs.shared.set("tutorialIsShown", newValue) }
    }
    static var savedStep: TutorialStep? {
        get { Prefs.string("onboarding.savedStep").flatMap { n in TutorialStep.allCases.first { $0.name == n } } }
        set { Prefs.shared.set("onboarding.savedStep", newValue?.name) }
    }
    static var screen: String {
        get { Prefs.string("onboarding.screen") ?? "current" }
        set { Prefs.shared.set("onboarding.screen", newValue) }
    }

    var step = TutorialStep.Start
    var previousStep = TutorialStep.Start
    var stepObject = Step()
    var textInTodo: String?

    private init() {
        stepObject = stage(.Start)!
        stepObject.screen = nil
    }

    /// Tutorial is running, most of the UI is locked
    static var active: Bool { !tutorialIsShown }
    static var step: TutorialStep { shared.step }

    /// Element frames in window coordinates, keyed by [OnboardingTarget] ids
    var targets = [String: CGRect]()

    /// Saves the todos on the add screen (AddTodoComplete / BreakdownTodoAction "got it") — set by the add screen
    @ObservationIgnored var saveTodo: () -> Void = {}
    /// Scrolls the settings list so the target is visible — set by the settings screen
    @ObservationIgnored var scrollToTarget: (String) -> Void = { _ in }

    /// Called with a step to jump there, or without to go to the following step
    static func nextStep(_ step: TutorialStep? = nil) { shared.goTo(step) }

    private func goTo(_ next: TutorialStep?) {
        guard let target = next ?? TutorialStep(rawValue: step.rawValue + 1) else { return }
        if step != .Close && step != .BreakdownLessThanTwo && step != .BreakdownCompletedTodo { previousStep = step }
        let staged = stage(target)
        if let staged, !staged.dontSave { Onboarding.savedStep = target }
        let obj = staged ?? Step()
        if let screen = obj.screen { changeScreen(screen) }
        if obj.scroll, let t = obj.target { scrollToTarget(t) }
        step = target
        stepObject = obj
    }

    /// changeSavedSreen: switches to a tab or the add screen and remembers it for restoring
    private func changeScreen(_ route: String) {
        Onboarding.screen = route
        switch route {
        case "add": if Nav.shared.sheet == nil { Nav.go(.add()) }
        case "planning": Nav.go(.planning)
        case "settings": Nav.go(.settings)
        default: Nav.go(.current)
        }
    }

    private func finish() {
        Onboarding.tutorialIsShown = true
        Onboarding.nextStep(.Start)
    }

    /// A centered "not allowed" message with one button
    private func gotIt(_ action: @escaping () -> Void) -> Step {
        Step(buttons: [OnboardingButton(preferred: true, notAllowed: true, action: action)], center: true, notShowContinue: true, notShowClose: true, dontSave: true)
    }

    /// AllStages from the RN OnboardingStore
    private func stage(_ s: TutorialStep) -> Step? {
        let next = Onboarding.nextStep
        switch s {
        case .Start:
            return Step(buttons: [OnboardingButton(message: "closeButtonText") { next(.Close) }], center: true, notShowClose: true, customContinueText: true, screen: "current")
        case .Close:
            return Step(buttons: [
                OnboardingButton(message: "changedMyMind", preferred: true) { [unowned self] in next(previousStep) },
                OnboardingButton(message: "article", preferred: true) { [unowned self] in finish(); Nav.go(.settings); Nav.push(.rules) },
                OnboardingButton(message: "closeEverything") { [unowned self] in finish(); Ui.toast(t("onboarding.Close.toast")) },
            ], center: true, notShowContinue: true, notShowClose: true, dontSave: true)
        case .Explain: return Step(center: true)
        case .AddTask: return Step(target: OnboardingTarget.plusButton, notShowContinue: true)
        case .AddText: return Step(target: OnboardingTarget.textRow, divider: 16, borderRadius: 16, screen: "add")
        case .SelectDate: return Step(target: OnboardingTarget.dateRow, dontSave: true, divider: 16, borderRadius: 16)
        case .SelectFrog: return Step(target: OnboardingTarget.frogRow, dontSave: true, customContinueText: true, divider: 16)
        case .SelectCompleted: return Step(target: OnboardingTarget.completedRow, dontSave: true, divider: 16)
        case .ShowMore: return Step(target: OnboardingTarget.showMoreRow, dontSave: true, divider: 16)
        case .AddAnotherTask: return Step(target: OnboardingTarget.addButton, dontSave: true)
        case .AddTodoComplete, .BreakdownTodoAction:
            return Step(target: OnboardingTarget.saveButton, buttons: [OnboardingButton(preferred: true, notAllowed: true) { [unowned self] in saveTodo() }],
                        notShowContinue: true, dontSave: true, divider: 16, borderRadius: 10, heightMultiplier: 6)
        case .ExplainCurrent: return Step(target: OnboardingTarget.currentTodo, divider: 11.5, screen: "current")
        case .DeleteEditComplete: return Step(target: OnboardingTarget.todoActions, divider: 4)
        case .Breakdown:
            return Step(target: OnboardingTarget.breakdownButton, buttons: [OnboardingButton(preferred: true, notAllowed: true) {
                if let todo = Todos.forDay(todayTitle(), false).first { Nav.go(.breakdown(todo.id)) }
            }], notShowContinue: true, divider: 8, heightMultiplier: 6)
        case .BreakdownTodo: return Step(target: OnboardingTarget.breakdownTodo, dontSave: true, divider: 16)
        case .BreakdownLessThanTwo: return gotIt { [unowned self] in next(previousStep) }
        case .BreakdownVanish: return Step(center: true)
        case .PlanningExplain: return Step(target: OnboardingTarget.tabPlanning, center: true, divider: 0.5, screen: "planning")
        case .PlanningExplain2: return Step(center: true)
        case .ExplainHashtags: return Step(center: true)
        case .ExplainSearchAndCompleted: return Step(target: OnboardingTarget.planningSegment, center: true)
        case .ExplainReccuring:
            return Step(buttons: [OnboardingButton(message: "article", preferred: true) { Ui.openUrl("https://blog.borodutch.com/automation-kills-productivity") }],
                        center: true, screen: "settings")
        case .ExplainSettings: return Step(target: OnboardingTarget.tabSettings, center: true, divider: 0.5)
        case .ExplainNotifications: return Step(center: true)
        case .ExplainMultiplatform:
            return Step(buttons: [OnboardingButton(message: "website", preferred: true) { Ui.openUrl("https://todorant.com") }], center: true)
        case .ExplainPricing: return Step(center: true)
        case .Feedback: return Step(target: OnboardingTarget.supportButton, scroll: true)
        case .Rules: return Step(target: OnboardingTarget.howToUse, scroll: true)
        case .Info: return Step(target: OnboardingTarget.infoButton, center: true, scroll: true)
        case .Congratulations:
            return Step(buttons: [OnboardingButton(message: "nextStepButton", preferred: true) { [unowned self] in
                finish()
                Effects.confetti(force: true)
            }], center: true, notShowContinue: true, notShowClose: true, customContinueText: true)
        case .BreakdownCompletedTodo: return gotIt { [unowned self] in next(previousStep == .SelectCompleted ? .ShowMore : previousStep) }
        case .SelectDateNotAllowed: return gotIt { next(.SelectFrog) }
        case .AddTextContinueButton:
            return Step(target: OnboardingTarget.textRow, buttons: [OnboardingButton(message: "continue", preferred: true) { [unowned self] in
                next((textInTodo ?? "").isEmpty ? .AddTextContinueTooFast : .SelectDate)
            }], notShowContinue: true, notShowMessage: true, dontSave: true, divider: 16, borderRadius: 16)
        case .AddTextContinueTooFast: return gotIt { next(.AddTextContinueButton) }
        case .Finished: return nil
        }
    }

    /// checkOnboardingStep: resumes an unfinished tutorial on launch
    static func restore() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard !tutorialIsShown, let saved = savedStep else { return }
            shared.changeScreen(screen)
            nextStep(saved)
        }
    }
}

extension View {
    /// Reports this view's frame to the tutorial under [id] (nil: not a target)
    @ViewBuilder
    func onboardingTarget(_ id: String?) -> some View {
        if let id, Onboarding.active {
            background(GeometryReader { g in
                let frame = g.frame(in: .global)
                Color.clear
                    .onAppear { Onboarding.shared.targets[id] = frame }
                    .onChange(of: frame) { _, f in Onboarding.shared.targets[id] = f }
            })
        } else {
            self
        }
    }
}

/// buildRnHole: grows the target bounds by 1/divider (height × heightMultiplier)
private func buildHole(_ r: CGRect, _ step: Step) -> CGRect {
    let halfH = r.height / step.divider * step.heightMultiplier
    let halfW = r.width / step.divider
    return r.insetBy(dx: -halfW / 2, dy: -halfH / 2)
}

private func hideKeyboard() { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }

/// The tutorial overlay: dims everything but a hole around the current target; touches only reach the app through the hole.
/// Shown above the tabs and, while it's open, above the add screen.
struct OnboardingOverlay: View {
    private var onboarding: Onboarding { Onboarding.shared }
    @State private var boxHeight: CGFloat = 0

    var body: some View {
        if Onboarding.active {
            GeometryReader { g in
                let origin = g.frame(in: .global).origin
                let size = g.size
                let step = onboarding.stepObject
                let target = step.target.flatMap { onboarding.targets[$0] }?.offsetBy(dx: -origin.x, dy: -origin.y)
                let hole = target.map { buildHole($0, step) } ?? CGRect(x: size.width / 2, y: size.height / 2, width: 0, height: 0)
                let radius = min(step.borderRadius, min(hole.width, hole.height) / 2)
                let y: CGFloat = {
                    let raw: CGFloat = step.center || target == nil ? (size.height - boxHeight) / 2
                        : hole.midY > size.height / 2 ? hole.minY - 16 - boxHeight : hole.maxY + 16
                    return min(max(raw, 0), max(size.height - boxHeight, 0))
                }()
                ZStack(alignment: .topLeading) {
                    Path { p in
                        p.addRect(CGRect(origin: .zero, size: size))
                        p.addRoundedRect(in: hole, cornerSize: CGSize(width: radius, height: radius))
                    }
                    .fill(Color.black.opacity(0.7), style: FillStyle(eoFill: true))
                    .allowsHitTesting(false)
                    // Four blockers around the hole so touches inside it reach the screen below
                    let top = min(max(hole.minY, 0), size.height)
                    let bottom = min(max(hole.maxY, top), size.height)
                    blocker(CGRect(x: 0, y: 0, width: size.width, height: top))
                    blocker(CGRect(x: 0, y: bottom, width: size.width, height: size.height - bottom))
                    blocker(CGRect(x: 0, y: top, width: max(0, min(hole.minX, size.width)), height: bottom - top))
                    blocker(CGRect(x: min(max(hole.maxX, 0), size.width), y: top, width: max(0, size.width - hole.maxX), height: bottom - top))

                    MessageBox(step: step, stepKey: onboarding.step.key)
                        .padding(12).frame(maxWidth: 424).frame(maxWidth: .infinity)
                        .background(GeometryReader { b in Color.clear.onAppear { boxHeight = b.size.height }.onChange(of: b.size.height) { _, h in boxHeight = h } })
                        .offset(y: y)
                }
                .animation(.easeInOut(duration: 0.5), value: hole)
                .animation(.easeInOut(duration: 0.5), value: y)
            }
            .ignoresSafeArea()
            // Inside the safe area, unlike the dimming
            .overlay { closeButton }
            .transition(.opacity)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                if onboarding.step == .AddText { Onboarding.nextStep(.AddTextContinueButton) }
            }
        }
    }

    @ViewBuilder
    private var closeButton: some View {
        let step = onboarding.stepObject
        if !step.notShowClose {
            let atBottom = onboarding.step == .AddAnotherTask || onboarding.step == .ExplainSearchAndCompleted
            Button { hideKeyboard(); Onboarding.nextStep(.Close) } label: {
                Image(systemName: "xmark").font(.system(size: 22, weight: .semibold)).foregroundStyle(.white).frame(width: 48, height: 48)
            }
            .accessibilityLabel(t("onboarding.Close.closeEverything"))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: atBottom ? .bottomTrailing : .topTrailing)
            .padding(12)
        }
    }

    private func blocker(_ r: CGRect) -> some View {
        Color.black.opacity(0.001).frame(width: max(r.width, 0), height: max(r.height, 0)).offset(x: r.minX, y: r.minY)
            .onTapGesture {}
    }
}

private struct MessageBox: View {
    let step: Step
    let stepKey: String

    var body: some View {
        VStack(spacing: 0) {
            if Onboarding.step == .Start || Onboarding.step == .Explain {
                Image("nikita").resizable().scaledToFill().frame(width: 104, height: 104).clipShape(Circle())
                    .overlay(Circle().stroke(Colors.background, lineWidth: 2)).padding(12)
            }
            if !step.notShowMessage {
                let bodyKey = "onboarding.\(stepKey).messageBoxBody"
                Text(I18n.has(bodyKey) ? t(bodyKey) : "").foregroundStyle(Colors.text).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18).background(Colors.background, in: RoundedRectangle(cornerRadius: 28))
                    .id(stepKey).transition(.opacity)
            }
            if !step.notShowContinue {
                OnboardingButtonView(title: step.customContinueText ? t("onboarding.\(stepKey).nextStepButton") : t("onboarding.defaultNextStepButtonText"), preferred: true) {
                    hideKeyboard(); Onboarding.nextStep()
                }
            }
            ForEach(Array(step.buttons.enumerated()), id: \.offset) { _, button in
                OnboardingButtonView(title: button.notAllowed ? t("onboarding.notAllowed") : t("onboarding.\(stepKey).\(button.message ?? "")"), preferred: button.preferred) {
                    hideKeyboard(); button.action()
                }
            }
        }
        .animation(.easeInOut(duration: 0.5), value: stepKey)
    }
}

private struct OnboardingButtonView: View {
    let title: String
    let preferred: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).foregroundStyle(preferred ? .white : .black).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(18)
                .background {
                    if preferred { LinearGradient(colors: [Color(UIColor(rgb: 0x1148B9)), Color(UIColor(rgb: 0x3581FC))], startPoint: .leading, endPoint: .trailing) } else { Color.white }
                }
                .clipShape(RoundedRectangle(cornerRadius: 28))
                .opacity(preferred ? 1 : 0.7)
        }
        .buttonStyle(.plain).padding(.top, 12)
    }
}
