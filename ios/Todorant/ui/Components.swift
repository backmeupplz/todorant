import SwiftUI

/// An icomoon glyph
struct TIcon: View {
    let name: String
    var size: CGFloat = 28
    var color: Color = Colors.text

    var body: some View {
        Text(Icons.codes[name] ?? "?").font(Fonts.icons(size)).foregroundStyle(color).frame(width: size, height: size)
    }
}

/// IconButton from the RN app
struct IconBtn: View {
    let name: String
    var color: Color? = nil
    var fullColor = false
    var size: CGFloat = 28
    var disabled = false
    var label: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            TIcon(name: name, size: size, color: disabled ? .gray : color ?? Colors.defaultIcon)
                .opacity(fullColor ? 1 : 0.8).padding(.horizontal, 6).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(disabled)
        .accessibilityLabel(label ?? name)
    }
}

struct InfoButton: View {
    let message: String

    var body: some View {
        Button { Ui.info(message) } label: { TIcon(name: "-Icon-1", size: 24, color: Colors.text).opacity(0.5) }
            .buttonStyle(.plain).accessibilityLabel(t("infoTitle"))
    }
}

struct Divider: View {
    var color: Color = Colors.border
    var vertical: CGFloat = 6
    var horizontal: CGFloat = 16

    var body: some View {
        Rectangle().fill(color).frame(height: 1 / UIScreen.main.scale * 2).padding(.horizontal, horizontal).padding(.vertical, vertical)
    }
}

/// Thin bar with a filled part
struct ProgressBar: View {
    let progress: Double
    let tint: Color
    let track: Color
    var height: CGFloat = 4

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(tint).frame(width: g.size.width * min(max(progress, 0), 1))
            }
        }
        .frame(height: height)
    }
}

/// Completed / total with one dash per todo (a bar when there are more than 20)
struct SegmentedProgressView: View {
    let completed: Int
    let total: Int

    var body: some View {
        HStack(spacing: 0) {
            Text("\(completed)").font(Fonts.rounded(22)).foregroundStyle(Colors.primary).padding(.horizontal, 16)
            if total <= 20 {
                HStack(spacing: 8) {
                    ForEach(0..<total, id: \.self) { i in
                        Capsule().fill(i < completed ? Colors.primary : Colors.text.opacity(0.2)).frame(height: 4)
                    }
                }
                .padding(.horizontal, 4)
            } else {
                ProgressBar(progress: Double(completed) / Double(total), tint: Colors.primary, track: Colors.text.opacity(0.2)).padding(.horizontal, 4)
            }
            Text("\(total)").font(Fonts.rounded(22)).foregroundStyle(Colors.primary).padding(.horizontal, 16)
        }
        .padding(.vertical, 16)
        .accessibilityElement(children: .combine)
    }
}

private func shortNumber(_ n: Int) -> String {
    if n >= 1_000_000 { return "\(Double(n / 100_000) / 10)M".replacingOccurrences(of: ".0M", with: "M") }
    if n >= 1_000 { return "\(Double(n / 100) / 10)K".replacingOccurrences(of: ".0K", with: "K") }
    return "\(n)"
}

/// Hero points with progress to the next rank; opens the hero screen
struct HeroButton: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let colors = Colors.forRank(Hero.rankIndex)
        let tint = colors[scheme == .dark ? 2 : 3]
        let track = colors[scheme == .dark ? 3 : 2]
        Button { Nav.push(.hero) } label: {
            VStack(spacing: 2) {
                Text(shortNumber(Hero.points)).font(Fonts.rounded(20, .bold)).foregroundStyle(tint)
                ProgressBar(progress: Hero.progress, tint: tint, track: track).frame(width: 30)
            }
            .frame(minWidth: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Hero.points) \(t("points"))")
    }
}

/// The floating gradient "+" button
struct PlusButton: View {
    var enabled = true
    var action: () -> Void = { Nav.go(.add()) }

    var body: some View {
        Button(action: action) {
            TIcon(name: "add_outline_28", size: 20, color: .white)
                .frame(width: 48, height: 64)
                .background(brandGradient, in: RoundedRectangle(cornerRadius: 28))
                .shadow(color: .black.opacity(0.15), radius: 6, y: 3)
        }
        .buttonStyle(.plain).disabled(!enabled)
        .padding(.trailing, 16).padding(.bottom, 24)
        .accessibilityLabel(t("addTodo"))
    }
}

/// Day/month or user section header (TodoHeader)
struct TodoHeader: View {
    let item: String
    var date = false
    var hidePlus = false
    var plusEnabled = true

    var label: String {
        guard date, item.count == 10, let day = parseTitle(item) else { return item }
        let f = DateFormatter()
        f.locale = I18n.locale
        f.dateFormat = "EEEE"
        return "\(item), \(capitalizeSentence(f.string(from: day)))"
    }

    var body: some View {
        HStack(spacing: 0) {
            Text(label).font(Fonts.rounded(17)).foregroundStyle(Colors.primary)
                .padding(.leading, 16).padding(.trailing, 12).padding(.vertical, 4)
                .background(Color(UIColor(rgb: 0xFF641A, alpha: 0.06)), in: UnevenRoundedRectangle(bottomTrailingRadius: 6, topTrailingRadius: 6))
            if !hidePlus {
                IconBtn(name: "add_outline_28", color: Colors.primary, size: 20, disabled: !plusEnabled, label: t("addTodo")) { Nav.go(.add(date: item)) }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 16).padding(.bottom, 8)
    }
}

/// Big emoji + title + text placeholders
struct Placeholder: View {
    let emoji: String
    let title: String?
    let text: String
    var topMargin: CGFloat = 12
    var margin: CGFloat = 12

    var body: some View {
        VStack(spacing: 0) {
            Text(emoji).font(.system(size: 32)).padding(.bottom, 12)
            if let title {
                Text(title).font(.system(size: 28, weight: .bold)).foregroundStyle(Colors.text.opacity(0.9))
                    .multilineTextAlignment(.center).padding(.bottom, 16)
            }
            Text(text).font(Fonts.text()).foregroundStyle(Colors.text.opacity(0.8)).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 24 + margin).padding(.top, topMargin).padding(.bottom, margin)
        .frame(maxWidth: .infinity)
    }
}

/// Full width rounded primary button (native-base Button)
struct PrimaryButton: View {
    let text: String
    var color: Color = Colors.primary
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 16, weight: .medium)).foregroundStyle(.white).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.vertical, 14).padding(.horizontal, 16)
                .background(enabled ? color : .gray, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain).disabled(!enabled)
    }
}

/// Horizontal shake (react-native-animatable's shake) whenever [trigger] grows
struct Shake: GeometryEffect {
    var trigger: CGFloat
    var animatableData: CGFloat {
        get { trigger }
        set { trigger = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(trigger * .pi * 6), y: 0))
    }
}

extension View {
    func shake(_ trigger: Int) -> some View { modifier(Shake(trigger: CGFloat(trigger))).animation(.linear(duration: 0.42), value: trigger) }

    /// Keeps lists readable on iPad: content no wider than [width], centered
    func readableWidth(_ width: CGFloat = 720) -> some View {
        modifier(ReadableWidth(width: width))
    }
}

private struct ReadableWidth: ViewModifier {
    let width: CGFloat
    func body(content: Content) -> some View {
        GeometryReader { g in
            content.contentMargins(.horizontal, max(0, (g.size.width - width) / 2), for: .scrollContent)
        }
    }
}

/// Wraps its children into rows (hashtag suggestions)
struct FlowLayout: Layout {
    var spacing: CGFloat = 0

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .unspecified)
                x += size.width + spacing
            }
        }
    }

    private struct Row { var items = [Int](); var width: CGFloat = 0; var height: CGFloat = 0; var y: CGFloat = 0 }

    private func arrange(_ maxWidth: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows = [Row()]
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + size.width > maxWidth {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += size.width + spacing
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}

/// Segmented picker in the app's colors (planning and delegation headers)
struct SegmentedControl: View {
    let options: [String]
    let selected: Int
    let onSelect: (Int) -> Void

    var body: some View {
        Picker("", selection: Binding(get: { selected }, set: onSelect)) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, o in Text(o).tag(i) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }
}
