import SwiftUI

struct DelegationScreen: View {
    var body: some View {
        let state = AppState.shared
        let sections: [(DelegateSection, String)] = [(.toMe, "delegate.ToMe"), (.byMe, "delegate.ByMe"), (.completed, "completed")]
        Group {
            if Session.user == nil {
                ScrollView { Placeholder(emoji: "🐶", title: t("delegate.signupTitle"), text: t("delegate.signupDescription"), topMargin: 30) }
                    .background(Colors.background)
            } else {
                DelegationList(section: state.delegateSection)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                SegmentedControl(options: sections.map { t($0.1) }, selected: sections.firstIndex { $0.0 == state.delegateSection } ?? 0) {
                    state.delegateSection = sections[$0].0
                }
                .frame(maxWidth: 360)
            }
            ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "delegate.info") }
        }
    }
}

private struct DelegationList: View {
    let section: DelegateSection

    var body: some View {
        let byMe = section != .toMe
        // Counterpart: the delegate for todos I delegated, the delegator for todos delegated to me
        let names = Dictionary((byMe ? Db.shared.delegates() : Db.shared.delegators()).map { ($0.id, $0.name ?? "") }, uniquingKeysWith: { a, _ in a })
        var order = [String]()
        var byUser = [String: [Todo]]()
        for todo in Todos.delegated(byMe: byMe, completed: section == .completed) {
            guard let id = byMe ? todo.userId : todo.delegatorId, names[id] != nil else { continue }
            if byUser[id] == nil { order.append(id) }
            byUser[id, default: []].append(todo)
        }
        return List {
            if order.isEmpty {
                Placeholder(emoji: "🏅", title: nil, text: t(section == .toMe ? "delegate.noDelegatedTasks" : "delegate.noDelegatedTasksTo"), topMargin: 30).plainRow()
            }
            ForEach(order, id: \.self) { id in
                let name = names[id]!
                if !name.isEmpty { TodoHeader(item: name, hidePlus: true).plainRow() }
                ForEach(byUser[id]!, id: \.id) { TodoCard(todo: $0, type: .delegation).plainRow() }
            }
            Color.clear.frame(height: 24).plainRow()
        }
        .appList()
        .readableWidth()
    }
}
