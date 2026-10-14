import SwiftUI

extension View {
    /// A full-width list row on the app background without separators
    func plainRow() -> some View {
        listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Colors.background)
    }

    /// Plain list on the app background
    func appList() -> some View {
        listStyle(.plain).scrollContentBackground(.hidden).background(Colors.background).environment(\.defaultMinListRowHeight, 0)
    }
}

struct CurrentScreen: View {
    var body: some View {
        let today = Clock.shared.today
        let uncompleted = Todos.forDay(today, false)
        let completedCount = Todos.forDay(today, true).count
        let epics = Db.shared.epics()
        let total = uncompleted.count + completedCount
        List {
            if !epics.isEmpty {
                ForEach(epics, id: \.id) { EpicProgress(epic: $0).plainRow() }
                    .onMove { from, to in
                        var list = epics
                        list.move(fromOffsets: from, toOffset: to)
                        saveEpicOrder(list)
                    }
                    .moveDisabled(Onboarding.active)
            }
            if total > 0 { SegmentedProgressView(completed: completedCount, total: total).plainRow() }
            if let todo = uncompleted.first { TodoCard(todo: todo, type: .current).id(todo.id).plainRow() }
            if total > 0 && uncompleted.isEmpty {
                Placeholder(emoji: "🎉", title: t("allDoneTitle"), text: t("allDoneText"), topMargin: 0, margin: 0).plainRow()
            }
            if total == 0 { Placeholder(emoji: "🐝", title: t("noTodosTitle"), text: t("noTodosText"), topMargin: 32).plainRow() }
            Color.clear.frame(height: 80).plainRow()
        }
        .appList()
        .readableWidth()
        .navigationTitle(t("current"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoCurrent") }
            if Settings.gamificationOn { ToolbarItem(placement: .topBarTrailing) { HeroButton() } }
        }
        .overlay(alignment: .bottomTrailing) {
            PlusButton(enabled: !Onboarding.active || Onboarding.step == .AddTask)
                .onboardingTarget(OnboardingTarget.plusButton)
        }
    }

    private func saveEpicOrder(_ epics: [Tag]) {
        for (i, epic) in epics.enumerated() { epic.epicOrder = i }
        Db.shared.save(TagEntity, epics)
    }
}

private struct EpicProgress: View {
    let epic: Tag

    var body: some View {
        let color = epic.color.flatMap { $0.isEmpty ? nil : hex($0) }
        HStack(spacing: 0) {
            EpicText(text: "\(epic.epicPoints)", color: color)
            VStack(spacing: 4) {
                EpicText(text: "#\(epic.tag)", color: color).onTapGesture {
                    if !AppState.shared.hash.contains("#\(epic.tag)") { AppState.shared.hash.append("#\(epic.tag)") }
                    Nav.go(.planning)
                }
                // RN showed (points || 1) / goal, so an epic with 0 points looked started
                ProgressBar(progress: epic.epicGoal > 0 ? Double(epic.epicPoints) / Double(epic.epicGoal) : 0,
                            tint: color ?? Colors.primary, track: Colors.progressBarBackground)
            }
            .frame(maxWidth: .infinity)
            // Raw comparison like RN: an epic without a goal shows the goal, not the complete button
            if epic.epicPoints != epic.epicGoal {
                EpicText(text: "\(epic.epicGoal)", color: color)
            } else {
                IconBtn(name: "done_outline_28--check", color: color ?? Colors.destruct, label: t("completed")) { Tags.completeEpic(epic) }
                    .padding(.trailing, 8)
            }
        }
        .padding(.vertical, 8)
        .background(Colors.background)
    }
}

private struct EpicText: View {
    let text: String
    let color: Color?

    var body: some View {
        Text(text).font(Fonts.rounded(22)).foregroundStyle(color ?? Colors.primary).padding(.horizontal, 16)
    }
}
