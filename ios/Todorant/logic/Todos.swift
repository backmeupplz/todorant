import Foundation

/// Queries from TodoStore / PlanningVM, with delegation users referenced by server id
enum Todos {
    private static var me: String { Session.user?.id ?? "" }
    private static var db: Db { Db.shared }

    private static func dateWhere(_ title: String) -> String { title.count == 10 ? "date = ?" : "(date = '' OR date IS NULL)" }

    /// Bound arguments for [dateWhere]
    private static func dateArgs(_ title: String) -> [Any?] { title.count == 10 ? [String(title.suffix(2))] : [] }

    /// Todos from delegators we're no longer connected to stay hidden (the RN app deleted them locally on pull)
    private static let KNOWN_DELEGATOR = "(delegator IS NULL OR delegator = ? OR delegator IN (SELECT id FROM users WHERE isDelegator = 1))"

    /// Own todos and accepted todos delegated to me for a day (getTodos)
    static func forDay(_ title: String, _ completed: Bool) -> [Todo] {
        db.todos(
            "\(Db.UNDELETED) AND delegateAccepted IS NOT 0 AND completed = ? AND monthAndYear = ? AND \(dateWhere(title)) AND " +
                "((delegateAccepted IS NOT 1 AND delegator IS NULL) OR (delegateAccepted = 1 AND delegator IS NOT ?)) AND \(KNOWN_DELEGATOR)",
            [completed, String(title.prefix(7))] + dateArgs(title) + [me, me], orderBy: "frog DESC, \"order\" ASC"
        )
    }

    /// todosForDate: everything on a day, used for ordering
    static func allForDay(_ title: String, _ completed: Bool? = nil) -> [Todo] {
        db.todos(
            "\(Db.UNDELETED) AND delegateAccepted IS NOT 0 AND monthAndYear = ? AND \(dateWhere(title))" +
                (completed.map { " AND completed = \($0 ? 1 : 0)" } ?? ""),
            [String(title.prefix(7))] + dateArgs(title), orderBy: "\"order\" ASC"
        )
    }

    /// Uncompleted todos before today — makes planning required
    static func oldCount() -> Int {
        db.count(
            "todos", "\(Db.UNDELETED) AND completed = 0 AND exactDate < ? AND (user IS NULL OR user = ?) AND " +
                "(delegator IS NULL OR delegateAccepted = 1) AND \(KNOWN_DELEGATOR)",
            [exactDate(todayTitle()) ?? 0, me, me]
        )
    }

    private static let PLANNING_WHERE = "\(Db.UNDELETED) AND completed = ? AND (user IS NULL OR user = ?) AND " +
        "(delegator IS NULL OR delegateAccepted = 1) AND \(KNOWN_DELEGATOR)"

    /// Planning/completed lists, optionally filtered by a search string
    static func planning(_ completed: Bool, _ search: String?, _ limit: Int) -> [Todo] {
        let like = search.flatMap { $0.isEmpty ? nil : "%\(sanitizeLike($0))%" }
        return db.todos(
            PLANNING_WHERE + (like != nil ? " AND text LIKE ?" : ""),
            [completed, me, me] + (like.map { [$0] } ?? []),
            orderBy: "exactDate \(completed ? "DESC" : "ASC"), frog DESC, \"order\" ASC", limit: limit
        )
    }

    /// getDelegationTodos
    static func delegated(byMe: Bool, completed: Bool = false) -> [Todo] {
        db.todos(
            "\(Db.UNDELETED) AND delegator IS NOT NULL AND completed = ? AND " +
                (byMe ? "delegator = ?" : "delegateAccepted IS NOT \(completed ? 0 : 1) AND user = ?"),
            [completed, me], orderBy: "exactDate ASC, \"order\" ASC"
        )
    }

    // region Actions (TodoCardVM)

    static func isSkippable(_ todo: Todo) -> Bool { !todo.frog && (todo.time ?? "").isEmpty && allForDay(todo.title, todo.completed).count > 1 }

    static func skip(_ todo: Todo) {
        let neighbours = allForDay(todo.title, todo.completed)
        var toUpdate = [Todo]()
        var startOffsetting = false
        var offset = 0
        var foundValidNeighbour = false
        for n in neighbours {
            if n.id == todo.id { startOffsetting = true; continue }
            if startOffsetting {
                offset += 1
                if !n.skipped {
                    n.order -= Double(offset)
                    toUpdate.append(n)
                    foundValidNeighbour = true
                    break
                }
            }
        }
        if !foundValidNeighbour {
            for (i, n) in neighbours.enumerated() where i > 0 {
                n.order -= 1
                toUpdate.append(n)
            }
        }
        todo.order += Double(offset)
        todo.skipped = true
        toUpdate.removeAll { $0.id == todo.id }
        toUpdate.append(todo)
        db.saveTodos(toUpdate)
        fixOrder([todo.title], timeTodosToYield: [todo])
    }

    static func moveToToday(_ todo: Todo) {
        let today = todayWithStartOfDay()
        // RN crashed here when today had no todos yet
        let lastOrder = allForDay(today.dateString).last?.order ?? -1
        db.updateTodo(todo) {
            $0.order = lastOrder + 1
            $0.date = today.day
            $0.monthAndYear = today.monthAndYear
        }
    }

    static func delete(_ todo: Todo) {
        let doDelete = { db.updateTodo(todo) { $0.deleted = true } }
        if Settings.askBeforeDelete {
            Ui.confirm("\(t("deleteTodo")) \"\(todo.text.ellipsize(50))\"?", t("delete"), destructive: true) { doDelete() }
        } else { doDelete() }
    }

    static func accept(_ todo: Todo) {
        if (todo.date ?? "").isEmpty && (todo.monthAndYear ?? "").isEmpty {
            Nav.go(.edit(todo.id))
            return
        }
        db.updateTodo(todo) { $0.delegateAccepted = true }
        fixOrder([todo.title])
    }

    static func uncomplete(_ todo: Todo) { db.updateTodo(todo) { $0.completed = false } }

    /// A todo moved too often has to be broken down instead
    static func requestBreakdown(_ todo: Todo, before: @escaping () -> Void = {}) {
        Ui.alert(t("error"), t("breakdownRequest"), [
            (t("cancel"), {}),
            (t("breakdownButton"), { before(); Nav.go(.breakdown(todo.id)) }),
        ])
    }

    static func breakdownOrComplete(_ todo: Todo) {
        if todo.repetitive {
            Ui.alert(t("breakdownMessage.title"), t("breakdownMessage.text"), [
                (t("cancel"), {}),
                (t("breakdownMessage.complete"), { complete(todo) }),
                (t("breakdownButton"), { Nav.go(.breakdown(todo.id)) }),
            ])
        } else { complete(todo) }
    }

    static func complete(_ todo: Todo) {
        if todo.frog { Sounds.frogComplete() } else {
            if forDay(todayTitle(), false).contains(where: \.frog) { Ui.message(t("frogsAlert.title"), t("frogsAlert.text")) }
            Sounds.taskComplete()
        }
        markCompleted(todo)
        Effects.confetti()
        checkDayCompletion()
    }

    /// Completion bookkeeping without sounds or dialogs (also used by breakdowns and the widget)
    static func markCompleted(_ todo: Todo) {
        Hero.points += 1
        Tags.incrementEpicPoints(todo.text)
        db.updateTodo(todo) { $0.completed = true }
        Session.numberOfTodosCompleted += 1
    }

    // endregion

    // region Day completion (dayCompleteRoutine.ts)

    static func shouldShowDayCompletion() -> Bool {
        if !Settings.soundOn && !Settings.endOfDaySoundOn { return false }
        let today = allForDay(todayTitle())
        return !today.isEmpty && today.allSatisfy(\.completed)
    }

    static func checkDayCompletion() {
        if shouldShowDayCompletion() {
            Effects.dayComplete()
            Sounds.dayComplete()
        }
    }

    // endregion

    // region fixOrder (fixOrder.ts)

    static func fixOrder(_ titles: [String], addTodosOnTop: [Todo] = [], addTodosToBottom: [Todo] = [], timeTodosToYield: [Todo] = []) {
        let onTop = Set(addTodosOnTop.map(\.id))
        let onBottom = Set(addTodosToBottom.map(\.id))
        let yieldIds = Set(timeTodosToYield.map(\.id))
        var toUpdate = [Todo]()
        var seen = Set<String>()
        for title in titles where seen.insert(title).inserted {
            let completed = sortForFix(allForDay(title, true), onTop, onBottom)
            for (i, todo) in completed.enumerated() where todo.order != Double(i) { todo.order = Double(i); toUpdate.append(todo) }
            var uncompleted = sortForFix(allForDay(title, false), onTop, onBottom)
            if Settings.preserveOrderByTime == true {
                while !isTimeSorted(uncompleted) { fixOneTodoTime(&uncompleted, yieldIds) }
            }
            for (i, todo) in uncompleted.enumerated() where todo.order != Double(i) { todo.order = Double(i); toUpdate.append(todo) }
        }
        db.saveTodos(toUpdate)
    }

    static func sortForFix(_ todos: [Todo], _ onTop: Set<String>, _ onBottom: Set<String>) -> [Todo] {
        // Stable sort: on-top group, then the rest by order, then on-bottom group
        func group(_ t: Todo) -> Int { onTop.contains(t.id) ? 0 : onBottom.contains(t.id) ? 2 : 1 }
        return todos.enumerated().sorted { a, b in
            (group(a.element), a.element.order, a.offset) < (group(b.element), b.element.order, b.offset)
        }.map(\.element)
    }

    /// nil for malformed times (parseInt gave NaN in RN, which never compared as smaller)
    static func minutes(_ time: String) -> Int? {
        let p = time.split(separator: ":", omittingEmptySubsequences: false)
        guard p.count > 1, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
        return h * 60 + m
    }

    static func isTimeSorted(_ todos: [Todo]) -> Bool {
        var last: Int?
        for t in todos {
            guard let m = t.time.flatMap(minutes) else { continue }
            if let last, m < last { return false }
            last = m
        }
        return true
    }

    static func fixOneTodoTime(_ todos: inout [Todo], _ yieldIds: Set<String>) {
        var time: Int?
        var prevIndex: Int?
        for (i, todo) in todos.enumerated() {
            guard let m = todo.time.flatMap(minutes) else { continue }
            if let time, let prevIndex, m < time {
                if yieldIds.contains(todo.id) {
                    // Current should be moved
                    todos.remove(at: i)
                    todos.insert(todo, at: prevIndex)
                } else {
                    // Previous todo should be moved
                    let prev = todos.remove(at: prevIndex)
                    todos.insert(prev, at: i)
                }
                return
            }
            time = m
            prevIndex = i
        }
    }

    // endregion

    /**
     * Unlinks a delegate or delegator on the server and deletes the todos shared with them,
     * like the RN app's removeDelegation
     */
    static func removeDelegation(_ user: DelegationUser) async throws {
        try await Rest.removeDelegation(user.id, isDelegator: user.isDelegator)
        let shared = db.todos(user.isDelegator ? "delegator = ?" : "user = ?", [user.id])
        for todo in shared {
            todo.deleted = true
            todo.delegateAccepted = true
        }
        db.saveTodos(shared)
    }

    /// TodoStore.recalculateExactDates
    static func recalculateExactDates() {
        let all = db.todos()
        db.write { all.forEach { db.writeLocal(TodoEntity, $0) } }
    }
}

enum Tags {
    /// tag text → color, for coloring hashtags
    static func colorMap() -> [String: String] {
        var map = [String: String]()
        for t in Db.shared.undeletedTags() { if let c = t.color, !c.isEmpty { map[t.tag] = c } }
        return map
    }

    /// Tags suggested while typing (TodoVM.tags)
    static func suggestions(_ text: String, showMore: Bool) -> [Tag] {
        if text.hasSuffix("#") { return Db.shared.undeletedTags() }
        guard let match = text.range(of: "#[\\u0400-\\u04FFa-zA-Z_0-9]+$", options: .regularExpression) else {
            return Settings.showMoreByDefault == true || showMore ? Db.shared.undeletedTags() : []
        }
        return Db.shared.undeletedTags("tag LIKE ?", ["%\(sanitizeLike(String(text[match].dropFirst())))%"])
    }

    static func completeEpic(_ epic: Tag) {
        Db.shared.updateTag(epic) {
            $0.epic = false; $0.epicPoints = 0; $0.epicGoal = 0; $0.epicCompleted = true
        }
    }

    static func incrementEpicPoints(_ text: String) {
        let tags = Set(hashtags(text))
        let epics = Db.shared.epics().filter { tags.contains($0.tag) && $0.epicGoal > 0 && $0.epicPoints < $0.epicGoal }
        epics.forEach { $0.epicPoints += 1 }
        Db.shared.save(TagEntity, epics)
    }

    /// Counts hashtag uses and creates new tags
    static func addTags(_ texts: [String]) {
        var counts = [String: Int]()
        for tag in texts.flatMap(hashtags) { counts[tag, default: 0] += 1 }
        if counts.isEmpty { return }
        let existing = Db.shared.undeletedTags().filter { counts[$0.tag] != nil }
        existing.forEach { $0.numberOfUses += counts[$0.tag]! }
        let known = Set(existing.map(\.tag))
        // Sorted so new tags are created in a stable order
        Db.shared.save(TagEntity, existing + counts.keys.filter { !known.contains($0) }.sorted().map { Tag(tag: $0) })
    }
}
