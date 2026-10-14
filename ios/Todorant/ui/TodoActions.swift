import Foundation

/// The todo actions that show dialogs, play sounds or navigate (the rest of Todos is shared with the widget)
extension Todos {
    private static var db: Db { Db.shared }

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

    static func checkDayCompletion() {
        if shouldShowDayCompletion() {
            Effects.dayComplete()
            Sounds.dayComplete()
        }
    }

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
}
