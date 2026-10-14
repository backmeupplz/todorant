import AppIntents
import SwiftUI
import WidgetKit

/**
 * Home screen widget showing the current todo, like the Android one: it reads and changes the shared
 * database (App Group) and the app pushes the changes when it next syncs.
 */
struct Entry: TimelineEntry {
    let date: Date
    let loggedIn: Bool
    let todo: Todo?
    let skippable: Bool
    let total: Int
    let done: Int
}

private func currentEntry() -> Entry {
    Db.shared.open()
    let today = todayTitle()
    guard Session.user != nil else { return Entry(date: Date(), loggedIn: false, todo: nil, skippable: false, total: 0, done: 0) }
    let uncompleted = Todos.forDay(today, false)
    let done = Todos.forDay(today, true).count
    let todo = uncompleted.first
    return Entry(date: Date(), loggedIn: true, todo: todo, skippable: todo.map { !$0.skipped && Todos.isSkippable($0) } ?? false,
                 total: uncompleted.count + done, done: done)
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), loggedIn: true, todo: Todo(text: "Plan the week", frog: true), skippable: true, total: 5, done: 2)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // The app reloads the widget after every change; a new day needs a redraw on its own
        let next = min(calendar.startOfDay(for: Date()).plusDays(1).addingTimeInterval(60), Date().addingTimeInterval(30 * 60))
        completion(Timeline(entries: [currentEntry()], policy: .after(next)))
    }
}

/// Widget buttons act on the current todo
struct TodoAction: AppIntent {
    static var title: LocalizedStringResource = "Todo action"
    static var isDiscoverable = false

    @Parameter(title: "Todo") var id: String
    @Parameter(title: "Action") var action: String

    init() {}
    init(id: String, action: String) {
        self.id = id
        self.action = action
    }

    func perform() async throws -> some IntentResult {
        Db.shared.open()
        if let todo = Db.shared.todo(id), !todo.completed, !todo.deleted {
            switch action {
            // Todos.complete without sounds, dialogs and confetti: no app to show them in
            case "done": Todos.markCompleted(todo)
            case "delete": Db.shared.updateTodo(todo) { $0.deleted = true }
            case "skip": if Todos.isSkippable(todo) { Todos.skip(todo) }
            default: break
            }
        }
        return .result()
    }
}

private let primary = Color(red: 0xEB / 255, green: 0x6A / 255, blue: 0x52 / 255)

/// One dash per todo, or a bar when they don't fit
private struct Lines: View {
    let total: Int
    let done: Int

    var body: some View {
        if total <= 12 {
            HStack(spacing: 4) {
                ForEach(0..<max(total, 1), id: \.self) { i in Capsule().fill(i < done ? primary : Color.gray.opacity(0.35)).frame(height: 3) }
            }
        } else {
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.gray.opacity(0.35))
                    Capsule().fill(primary).frame(width: g.size.width * CGFloat(done) / CGFloat(total))
                }
            }
            .frame(height: 3)
        }
    }
}

struct WidgetView: View {
    let entry: Entry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !entry.loggedIn {
                Text(t("pleaseLogin")).font(.headline).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 8) {
                    Text("\(entry.done)").foregroundStyle(primary)
                    Lines(total: entry.total, done: entry.done)
                    Text("\(entry.total)").foregroundStyle(primary)
                }
                .font(.system(size: 15, design: .rounded))
                if let todo = entry.todo {
                    Text((todo.frog ? "🐸 " : "") + ((todo.time ?? "").isEmpty ? "" : "\(todo.time!) ") + todo.text)
                        .font(.system(size: family == .systemSmall ? 15 : 17)).lineLimit(family == .systemSmall ? 4 : 3)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    HStack {
                        Button(intent: TodoAction(id: todo.id, action: "delete")) { Image(systemName: "trash").foregroundStyle(.red) }.accessibilityLabel(t("delete"))
                        if entry.skippable {
                            Spacer()
                            Button(intent: TodoAction(id: todo.id, action: "skip")) { Image(systemName: "arrow.right").foregroundStyle(.blue) }.accessibilityLabel(t("skipped"))
                        }
                        Spacer()
                        Button(intent: TodoAction(id: todo.id, action: "done")) { Image(systemName: "checkmark").foregroundStyle(.green) }.accessibilityLabel(t("completed"))
                        if family != .systemSmall {
                            Spacer()
                            Link(destination: URL(string: "todorant://create-todo")!) { Image(systemName: "plus").foregroundStyle(.blue) }.accessibilityLabel(t("addTodo"))
                        }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .buttonStyle(.plain)
                } else {
                    let empty = entry.total > 0
                    Text(empty ? "🎉 \(t("allDoneTitle"))" : "🐝 \(t("noTodosTitle"))").font(.headline)
                    Text(empty ? t("allDoneText") : t("noTodosText")).font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
        }
        .containerBackground(for: .widget) { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.1, green: 0.1, blue: 0.1, alpha: 1) : .white }) }
        .widgetURL(URL(string: "todorant://"))
    }
}

@main
struct TodorantWidget: Widget {
    // The React Native app's kind, so widgets already on home screens keep working
    let kind = "TodorantWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { WidgetView(entry: $0) }
            .configurationDisplayName("Todorant")
            .description(t("current"))
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
