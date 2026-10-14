import SwiftUI

private let PAGE = 15

/**
 * Day titles followed by their todos, like the RN DraggableFlatList data. Month-only todos sort together with the
 * 1st of that month (same exact date), so they're grouped by title instead of trusting the order — the RN app
 * showed them under the wrong header.
 */
private func flatten(_ todos: [Todo]) -> [PlanningItem] {
    var order = [String]()
    var byTitle = [String: [Todo]]()
    for todo in todos {
        if byTitle[todo.title] == nil { order.append(todo.title) }
        byTitle[todo.title, default: []].append(todo)
    }
    return order.flatMap { [PlanningItem.title($0)] + byTitle[$0]!.map(PlanningItem.todo) }
}

struct PlanningScreen: View {
    @State private var limit = PAGE
    @State private var calendarMonth = Date()

    var body: some View {
        let state = AppState.shared
        let completed = state.todoSection == .completed
        let search = state.searchQuery.isEmpty ? state.hash.joined(separator: " ") : state.searchQuery
        let todos = Todos.planning(completed, search, limit)
        let _ = Clock.shared.today
        let planningRequired = Todos.oldCount() > 0 && !Onboarding.active
        let items = flatten(todos)
        let canDrag = !completed && !Onboarding.active
        List {
            if planningRequired && !completed {
                Text(t("planningText")).foregroundStyle(.white).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Colors.link).plainRow()
            }
            if state.calendarEnabled {
                // Keeps the shown month while the calendar is toggled, like RN's currentMonth/currentYear
                MonthCalendar(month: $calendarMonth) { Nav.go(.add(date: $0.dateString)) }.plainRow()
            }
            if items.isEmpty { Placeholder(emoji: "👀", title: t("noTodosExistTitle"), text: t("noTodosExistText")).plainRow() }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Group {
                    switch item {
                    case let .todo(todo): TodoCard(todo: todo, type: completed ? .done : .planning)
                    case let .title(title): TodoHeader(item: title, date: true, plusEnabled: !Onboarding.active)
                    }
                }
                .plainRow()
                .moveDisabled(!canDrag || index == 0)
                .onAppear {
                    // Load more when the end is reached (RN onEndReached + offset)
                    if index >= items.count - 3 && todos.count >= limit { limit += PAGE }
                }
            }
            .onMove { from, to in
                guard let from = from.first else { return }
                // onMove's destination counts the moved row; planningDrop wants its final index
                let final = to > from ? to - 1 : to
                // Nothing can go above the first day header
                if final == 0 { return }
                let result = planningDrop(from, final, items)
                Db.shared.saveTodos(result.updates)
                if let todo = result.breakdown { Todos.requestBreakdown(todo) }
            }
            Color.clear.frame(height: 120).plainRow()
        }
        .appList()
        .readableWidth()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { PlanningHeader(completed: completed) }
        .overlay(alignment: .bottomTrailing) { PlusButton(enabled: !Onboarding.active) }
        .onChange(of: completed) { limit = PAGE }
    }
}

private struct PlanningHeader: ToolbarContent {
    let completed: Bool

    var body: some ToolbarContent {
        let state = AppState.shared
        let locked = Onboarding.active
        ToolbarItem(placement: .topBarLeading) {
            if state.hash.isEmpty {
                Button {
                    if !locked {
                        state.searchQuery = ""
                        state.searchEnabled.toggle()
                    }
                } label: { Image(systemName: state.searchEnabled ? "xmark" : "magnifyingglass") }
                    .accessibilityLabel(t("search"))
            }
        }
        ToolbarItem(placement: .principal) {
            if !state.hash.isEmpty {
                Text(state.hash.joined(separator: " ")).lineLimit(1)
            } else if state.searchEnabled {
                PlanningSearchField()
            } else {
                SegmentedControl(options: [t("planning"), t("completed")], selected: completed ? 1 : 0) {
                    state.todoSection = $0 == 1 ? .completed : .planning
                }
                .frame(maxWidth: 280)
                .onboardingTarget(OnboardingTarget.planningSegment)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            if !state.hash.isEmpty {
                Button { state.hash.removeAll() } label: { Image(systemName: "xmark") }.accessibilityLabel(t("cancel"))
            } else if !completed {
                Button { state.calendarEnabled.toggle() } label: { TIcon(name: "calendar_outline_28--event", size: 24).opacity(0.5) }
                    .disabled(locked).accessibilityLabel(t("addTodoDay"))
            } else {
                InfoButton(message: "infoPlanning")
            }
        }
    }
}

private struct PlanningSearchField: View {
    @FocusState private var focused: Bool

    var body: some View {
        TextField("\(t("search"))...", text: Binding(get: { AppState.shared.searchQuery }, set: { AppState.shared.searchQuery = $0 }))
            .textFieldStyle(.plain).focused($focused).frame(minWidth: 200)
            .onAppear { focused = true }
    }
}
