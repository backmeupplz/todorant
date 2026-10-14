import SwiftUI
import UIKit

enum CardType { case current, planning, done, breakdown, delegation }

/// TodoCard from the RN app; a list row (swipes complete or delete)
struct TodoCard: View {
    let todo: Todo
    let type: CardType
    var showDivider = true
    @State private var expanded = false

    var body: some View {
        let swipeEnabled = Settings.swipeActions && !Onboarding.active && (type == .current || type == .planning)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if todo.frogFails > 0 {
                    HStack(spacing: 4) {
                        ForEach(0..<min(todo.frogFails, 5), id: \.self) { _ in Capsule().fill(Colors.primary).frame(width: 8, height: 6) }
                    }
                    .padding(.leading, 16).padding(.bottom, 6)
                }
                TodoCardBody(todo: todo, type: type) { expanded.toggle() }
                if type != .breakdown && type != .delegation && (expanded || type == .current) { TodoCardActions(todo: todo, type: type) }
                if type == .delegation { DelegateCardActions(todo: todo) }
            }
            .padding(.vertical, 10)
            if showDivider && type != .current { Divider(color: Colors.divider, vertical: 0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Colors.background)
        .onboardingTarget(type == .current ? OnboardingTarget.currentTodo : nil)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if swipeEnabled {
                Button { Todos.breakdownOrComplete(todo) } label: { Label(t("completed"), systemImage: "checkmark") }.tint(Colors.success)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if swipeEnabled {
                Button { Todos.delete(todo) } label: { Label(t("delete"), systemImage: "trash") }.tint(Colors.destruct)
            }
        }
    }
}

private struct TodoCardBody: View {
    let todo: Todo
    let type: CardType
    let toggle: () -> Void

    var body: some View {
        let isOld = type != .done && type != .delegation && isTodoOld(todo.monthAndYear, todo.date)
        let delegatorName = Db.shared.userName(todo.delegatorId, isDelegator: true)
        VStack(alignment: .leading, spacing: 0) {
            if let delegatorName, !delegatorName.isEmpty, type != .delegation {
                Text("\(t("delegate.from")): \(delegatorName)" + (todo.delegateAccepted == false ? " \(todo.title)" : ""))
                    .font(Fonts.text()).foregroundStyle(Colors.text).onTapGesture(perform: toggle)
            }
            TodoCardText(todo: todo, isOld: isOld) {
                if type == .breakdown || type == .delegation { Ui.copy(todo.text) } else { toggle() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isOld ? Colors.oldTodoBackground : .clear)
        .padding(.horizontal, 16)
    }
}

/// The text with tappable links and #hashtags (colored like their tags)
private struct TodoCardText: View {
    let todo: Todo
    let isOld: Bool
    let onTap: () -> Void

    var body: some View {
        let parts = linkify(todo.text)
        let tagColors = Tags.colorMap()
        let text = NSMutableAttributedString()
        let font = UIFont.systemFont(ofSize: 17)
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = 22
        func add(_ s: String, _ color: UIColor, link: String? = nil) {
            var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: style]
            if let link { attributes[.link] = link }
            text.append(NSAttributedString(string: s, attributes: attributes))
        }
        let textColor = UIColor(Colors.text)
        if isOld { add("! ", UIColor(rgb: 0xFF6347)) }
        if todo.frog { add("🐸 ", textColor) }
        if let time = todo.time, !time.isEmpty { add("\(time) ", textColor) }
        for (i, p) in parts.enumerated() {
            switch p {
            case let .plain(v): add(v, textColor)
            case let .link(_, v): add(v, UIColor(Colors.link), link: "\(i)")
            case let .hash(v): add(v, UIColor(tagColors[String(v.dropFirst())].map(hex) ?? Colors.link), link: "\(i)")
            }
        }
        return LinkText(text: text, label: (todo.frog ? "🐸 " : "") + (todo.time.map { "\($0) " } ?? "") + todo.text) { index in
            switch index.flatMap({ parts.indices.contains($0) ? parts[$0] : nil }) {
            case let .link(url, _): Ui.openUrl(url)
            case let .hash(v):
                if !AppState.shared.hash.contains(v) {
                    AppState.shared.hash.append(v)
                    Nav.go(.planning)
                }
            default: onTap()
            }
        }
    }
}

/// Non-selectable text whose taps report the link part index under the finger (nil outside links)
struct LinkText: UIViewRepresentable {
    let text: NSAttributedString
    var label: String
    let onTap: (Int?) -> Void

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        // Colors come from the text: links are tinted per hashtag
        view.linkTextAttributes = [:]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped)))
        view.isAccessibilityElement = true
        view.accessibilityTraits = .button
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        view.attributedText = text
        view.accessibilityLabel = label
        context.coordinator.onTap = onTap
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        return CGSize(width: width, height: ceil(uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject {
        var onTap: (Int?) -> Void = { _ in }

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view as? UITextView else { return }
            var point = gesture.location(in: view)
            point.x -= view.textContainerInset.left
            point.y -= view.textContainerInset.top
            let manager = view.layoutManager
            let glyph = manager.glyphIndex(for: point, in: view.textContainer)
            let rect = manager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: view.textContainer)
            let index = manager.characterIndexForGlyph(at: glyph)
            let link = rect.contains(point) && index < view.textStorage.length
                ? view.textStorage.attribute(.link, at: index, effectiveRange: nil) as? String : nil
            onTap(link.flatMap(Int.init))
        }
    }
}

private struct TodoCardActions: View {
    let todo: Todo
    let type: CardType

    var body: some View {
        let locked = Onboarding.active
        let skippable = type == .current && Todos.isSkippable(todo)
        HStack(spacing: 0) {
            HStack(spacing: 4) {
                if todo.encrypted { Image(systemName: "key.fill").accessibilityLabel(t("encryptTodo")) }
                if todo.skipped { Image(systemName: "arrow.right") }
                if todo.repetitive { Image(systemName: "repeat").accessibilityLabel(t("breakdownMessage.title")) }
            }
            .font(.system(size: 12)).foregroundStyle(.gray)
            Spacer()
            HStack(spacing: 0) {
                IconBtn(name: "delete_outline_28-iOS", color: Colors.destruct, disabled: locked, label: t("delete")) { Todos.delete(todo) }
                if type == .planning && todo.title != todayTitle() && !isTodoOld(todo.monthAndYear, todo.date) {
                    IconBtn(name: "reply_outline_28-1", label: "Move to today") { Todos.moveToToday(todo) }
                }
                IconBtn(name: "edit_outline_28", disabled: locked, label: t("editTodo")) { Nav.go(.edit(todo.id)) }
                if type == .current && skippable {
                    IconBtn(name: "arrow_right_outline_28--forward", disabled: locked, label: t("skipped")) { Todos.skip(todo) }
                }
                if type == .current || type == .planning {
                    IconBtn(name: "list_outline_28", disabled: locked && Onboarding.shared.step != .Breakdown, label: t("breakdownTodo")) {
                        Nav.go(.breakdown(todo.id))
                    }
                    .onboardingTarget(OnboardingTarget.breakdownButton)
                }
                if type == .done {
                    IconBtn(name: "arrow_uturn_right_outline_28", color: Colors.success, fullColor: true, label: t("planning")) { Todos.uncomplete(todo) }
                } else {
                    IconBtn(name: "done_outline_28--check", color: Colors.success, fullColor: true, disabled: locked, label: t("completed")) {
                        Todos.breakdownOrComplete(todo)
                    }
                }
            }
            .onboardingTarget(OnboardingTarget.todoActions)
        }
        .padding(.top, 6).padding(.horizontal, 16)
    }
}

private struct DelegateCardActions: View {
    let todo: Todo

    var body: some View {
        HStack(spacing: 0) {
            Text(todo.title).foregroundStyle(Colors.border)
            Spacer()
            if todo.delegateAccepted != true {
                IconBtn(name: "delete_outline_28-iOS", color: Colors.destruct, label: t("delete")) { Todos.delete(todo) }
                IconBtn(name: "edit_outline_28", label: t("editTodo")) { Nav.go(.edit(todo.id)) }
            }
            if AppState.shared.delegateSection == .toMe {
                Button(t("accept")) { Todos.accept(todo) }.buttonStyle(.plain).font(Fonts.text()).foregroundStyle(Colors.success)
            }
        }
        .padding(.top, 6).padding(.horizontal, 16)
    }
}
