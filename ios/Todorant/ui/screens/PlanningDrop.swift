import Foundation

/// A row of the planning list: a day (or month) title, or a todo
enum PlanningItem: Identifiable {
    case title(String)
    case todo(Todo)

    var id: String {
        switch self {
        case let .title(t): "h:\(t)"
        case let .todo(todo): "t:\(todo.id)"
        }
    }

    var todo: Todo? { if case let .todo(t) = self { t } else { nil } }
    var title: String? { if case let .title(t) = self { t } else { nil } }
}

/// What a drop in the planning list changes: todos to save, or a todo that failed too often and needs a breakdown
struct PlanningDrop {
    var updates: [Todo]
    var breakdown: Todo? = nil
}

/**
 * onDragEnd() from PlanningContent.tsx. [before] is the flattened list of day titles and todos
 * before the drag; the item at [from] was dropped at [to]. Returned todos are modified copies.
 *
 * Fixed RN bugs: dragging a day header down crashed (it read a todo as a title), month headers set date to ""
 * (rejected by the server), dropping a todo last in a day next to a frog crashed, and a moved todo took its date
 * from a neighbour instead of the day it was dropped into.
 */
func planningDrop(_ from: Int, _ to: Int, _ before: [PlanningItem], isOld: (Todo) -> Bool = { isTodoOld($0.monthAndYear, $0.date) }) -> PlanningDrop {
    if from == to { return PlanningDrop(updates: []) }
    var after = before
    after.insert(after.remove(at: from), at: to)
    func closestSection(_ index: Int, _ list: [PlanningItem]) -> Int { stride(from: index, through: 0, by: -1).first { list[$0].title != nil } ?? 0 }
    func item(_ i: Int) -> PlanningItem? { before.indices.contains(i) ? before[i] : nil }
    let sectionFrom = closestSection(from, before)
    let sectionTo = closestSection(to, after)

    if let moved = before[from].todo {
        let fromBottomToTop = from > to
        let toTodo = item(to)?.todo
        let near = item(fromBottomToTop ? to - 1 : to + 1)
        let nearTodo = near?.todo
        var secondOrder = nearTodo?.order ?? -1
        if nearTodo?.frog == true && !moved.frog { secondOrder = -1 }
        // Dropped right below a day header: there's no todo at `to` (undefined order in the RN app)
        var average = toTodo.map { ($0.order + secondOrder) / 2 } ?? (!fromBottomToTop ? secondOrder - 1 : secondOrder + 1)
        if let toTodo {
            let next = item(to + 1)
            if (!fromBottomToTop && next?.title != nil) || next == nil { average = toTodo.order + 1 }
            if near != nil && toTodo.frog && nearTodo?.frog != true && item(to - 1)?.title == nil { average = toTodo.order + 1 }
        }
        let todo = moved.copy()
        todo.order = average
        if sectionFrom == sectionTo { return PlanningDrop(updates: [todo]) }
        // Moved to another day
        guard let title = after[sectionTo].title else { return PlanningDrop(updates: []) }
        if isOld(moved) {
            if moved.frogFails >= 3 { return PlanningDrop(updates: [], breakdown: moved) }
            if moved.frogFails >= 1 { todo.frog = true }
            todo.frogFails += 1
        }
        redate(todo, title)
        return PlanningDrop(updates: [todo])
    }

    // A day header was moved: todos now under it belong to its day; sections that got new todos are renumbered
    var changed = Set<String>()
    var section: String?
    for item in after {
        if let t = item.title { section = t } else if let todo = item.todo, let section, todo.title != section { changed.insert(section) }
    }
    var updates = [Todo]()
    section = nil
    var order = 0
    for item in after {
        if let t = item.title {
            section = t
            order = 0
            continue
        }
        let todo = item.todo!
        if let section, changed.contains(section) {
            let copy = todo.copy()
            copy.order = Double(order)
            if todo.title != section { redate(copy, section) }
            if !TodoEntity.equal(copy, todo) { updates.append(copy) }
        }
        order += 1
    }
    return PlanningDrop(updates: updates)
}

private func redate(_ todo: Todo, _ title: String) {
    todo.monthAndYear = String(title.prefix(7))
    todo.date = title.count == 10 ? String(title.suffix(2)) : nil
}
