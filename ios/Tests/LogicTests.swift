import XCTest
@testable import Todorant

/// Ports of the Android unit tests (LogicTest, PlanningDropTest, AddTodoApplyTagTest) plus sync merge checks
final class LogicTests: XCTestCase {
    override func setUp() {
        Db.shared.open(":memory:")
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12, _ min: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    func testCryptoJsCompatible() {
        // Produced by crypto-js 4.1.1: AES.encrypt('Купить молоко #shop 🐸', 'pa$$word').toString()
        let fromCryptoJs = "U2FsdGVkX19Iq7lrISRqAVJxTEsszMteq76/yk4B32bM7BHCgY4sbGPyzrwO6rIlCvd1NRGzddXxmv6HIvpUkg=="
        XCTAssertEqual(Crypto.decrypt(fromCryptoJs, "pa$$word"), "Купить молоко #shop 🐸")
        XCTAssertNil(Crypto.decrypt(fromCryptoJs, "wrong"))
        XCTAssertNil(Crypto.decrypt("plain text", "pa$$word"))
        XCTAssertEqual(Crypto.decrypt(Crypto.encrypt("round trip", "k"), "k"), "round trip")
        // Same format as crypto-js: "Salted__" + 8 byte salt + AES-256-CBC
        let encrypted = Data(base64Encoded: Crypto.encrypt("x", "k"))!
        XCTAssertEqual(encrypted.prefix(8), Data("Salted__".utf8))
        XCTAssertEqual(encrypted.count, 32)
    }

    func testLinkifySplitsLinksAndHashtags() {
        let parts = linkify("Buy #milk at https://shop.com/item?id=1 and see example.org, ok #дом_2")
        XCTAssertEqual(parts, [
            .plain("Buy "), .hash("#milk"), .plain(" at "), .link(url: "https://shop.com/item?id=1", value: "shop.com/..."), .plain(" and see "),
            .link(url: "http://example.org", value: "example.org"), .plain(", ok "), .hash("#дом_2"),
        ])
        XCTAssertEqual(hashtags("Buy #milk at https://x.com/#anchor and #дом_2"), ["milk", "дом_2"])
        // Not a hashtag in the middle of a word
        XCTAssertEqual(hashtags("issue a#b"), [])
    }

    func testDates() {
        XCTAssertEqual(todayWithStartOfDay(date(2026, 10, 13, 3), "04:00").dateString, "2026-10-12")
        XCTAssertEqual(todayWithStartOfDay(date(2026, 10, 13, 5), "04:00").dateString, "2026-10-13")
        XCTAssertEqual(exactDate("2026-10-13"), 1791849600000)
        XCTAssertEqual(exactDate("2026-10"), exactDate("2026-10-01"))
        XCTAssertNil(exactDate(""))
    }

    func testOldTodos() {
        let firstOfMonth = date(2026, 11, 1)
        // The RN version missed this one: yesterday is in the previous month
        XCTAssertTrue(isTodoOld("2026-10", "31", firstOfMonth, "00:00"))
        XCTAssertFalse(isTodoOld("2026-11", "01", firstOfMonth, "00:00"))
        // Before the start of day "today" is still yesterday
        XCTAssertFalse(isTodoOld("2026-10", "31", date(2026, 11, 1, 2), "04:00"))
        XCTAssertTrue(isTodoOld("2026-11", nil, firstOfMonth, "00:00"))
        XCTAssertFalse(isTodoOld("2026-12", nil, firstOfMonth, "00:00"))
    }

    func testFixOrderHelpers() {
        func todo(_ id: String, _ order: Double, _ time: String? = nil) -> Todo { Todo(id: id, order: order, time: time) }
        let sorted = Todos.sortForFix([todo("a", 0), todo("new", 0), todo("b", 1)], ["new"], [])
        XCTAssertEqual(sorted.map(\.id), ["new", "a", "b"])
        var timed = [todo("x", 0, "10:00"), todo("y", 1), todo("z", 2, "09:00")]
        XCTAssertFalse(Todos.isTimeSorted(timed))
        while !Todos.isTimeSorted(timed) { Todos.fixOneTodoTime(&timed, ["z"]) }
        XCTAssertEqual(timed.map(\.id), ["z", "x", "y"])
    }

    func testServerUrls() {
        XCTAssertEqual(serverUrl(" todo.example.com/ "), "https://todo.example.com")
        XCTAssertEqual(serverUrl("http://192.168.1.5:1337"), "http://192.168.1.5:1337")
        XCTAssertEqual(serverUrl("HTTPS://Example.com:443/todorant/"), "https://example.com/todorant")
        XCTAssertNil(serverUrl("ftp://example.com"))
        XCTAssertNil(serverUrl("https://example.com/?a=1"))
        XCTAssertNil(serverUrl("https://"))
    }

    func testIdsHaveFreshRandomBytes() {
        let (a, b) = (Ids.new(), Ids.new())
        XCTAssertNotNil(a.range(of: "^[0-9a-f]{24}$", options: .regularExpression))
        // Bytes 4..8 are random for every id, not once per process
        XCTAssertNotEqual(a.dropFirst(8).prefix(10), b.dropFirst(8).prefix(10))
    }

    func testApplyTag() {
        XCTAssertTrue(applyTagText("buy milk", 8, "home") == ("buy milk #home ", 15))
        XCTAssertTrue(applyTagText("buy #ho", 7, "home") == ("buy #home ", 10))
        XCTAssertTrue(applyTagText("buy #", 5, "home") == ("buy #home ", 10))
        XCTAssertTrue(applyTagText("", 0, "x") == ("#x ", 3))
        XCTAssertTrue(applyTagText("a b", 1, "x") == ("a #x b", 5))
    }

    // region Ordering in the database

    private func save(_ title: String, _ texts: [String], frog: Set<String> = []) -> [Todo] {
        let todos = texts.enumerated().map { i, text in
            Todo(text: text, frog: frog.contains(text), order: Double(i), monthAndYear: String(title.prefix(7)), date: title.count == 10 ? String(title.suffix(2)) : nil)
        }
        Db.shared.saveTodos(todos)
        return todos
    }

    func testForDayPutsFrogsFirstAndFixOrderRenumbers() {
        let day = "2030-01-01"
        _ = save(day, ["a", "b", "frog"], frog: ["frog"])
        XCTAssertEqual(Todos.forDay(day, false).map(\.text), ["frog", "a", "b"])
        let new = Todo(text: "on top", order: 0, monthAndYear: "2030-01", date: "01")
        Db.shared.saveTodos([new])
        Todos.fixOrder([day], addTodosOnTop: [new])
        XCTAssertEqual(Todos.allForDay(day, false).map(\.text), ["on top", "a", "b", "frog"])
        XCTAssertEqual(Todos.allForDay(day, false).map(\.order), [0, 1, 2, 3])
    }

    func testSkipMovesTodoBelowNextOne() {
        let day = "2030-01-02"
        let todos = save(day, ["a", "b", "c"])
        Todos.skip(Db.shared.todo(todos[0].id)!)
        XCTAssertEqual(Todos.forDay(day, false).map(\.text), ["b", "a", "c"])
        XCTAssertTrue(Db.shared.todo(todos[0].id)!.skipped)
    }

    func testOldTodosMakePlanningRequired() {
        XCTAssertEqual(Todos.oldCount(), 0)
        _ = save("2020-01-01", ["old"])
        XCTAssertEqual(Todos.oldCount(), 1)
    }

    // endregion

    // region Planning drops

    private func todo(_ id: String, _ title: String, _ order: Double, frog: Bool = false, frogFails: Int = 0) -> PlanningItem {
        .todo(Todo(id: id, frog: frog, frogFails: frogFails, order: order, monthAndYear: String(title.prefix(7)), date: title.count > 7 ? String(title.suffix(2)) : nil))
    }

    private let a = "2030-01-01"
    private let b = "2030-01-02"
    private func list() -> [PlanningItem] { [.title(a), todo("a1", a, 0), todo("a2", a, 1), todo("a3", a, 2), .title(b), todo("b1", b, 0), todo("b2", b, 1)] }
    private let never: (Todo) -> Bool = { _ in false }

    func testDropSameDay() {
        XCTAssertEqual(planningDrop(1, 2, list(), isOld: never).updates.first?.order, 1.5) // a1 below a2
        XCTAssertEqual(planningDrop(3, 1, list(), isOld: never).updates.first?.order, -0.5) // a3 to the top
        XCTAssertEqual(planningDrop(1, 3, list(), isOld: never).updates.first?.order, 3) // a1 to the end of day a
    }

    func testDropOnAnotherDay() {
        let top = planningDrop(1, 4, list(), isOld: never).updates.first!
        XCTAssertEqual(top.date, "02")
        XCTAssertEqual(top.order, -1)
        let last = planningDrop(1, list().count - 1, list(), isOld: never).updates.first!
        XCTAssertEqual(last.date, "02")
        XCTAssertEqual(last.order, 2)
    }

    func testOldTodoMovedFailsBecomesFrogOrNeedsBreakdown() {
        var l = list()
        l[1] = todo("a1", a, 0, frogFails: 1)
        let t = planningDrop(1, 5, l) { _ in true }.updates.first!
        XCTAssertEqual(t.frogFails, 2)
        XCTAssertTrue(t.frog)
        l[1] = todo("a1", a, 0, frogFails: 3)
        let r = planningDrop(1, 5, l) { _ in true }
        XCTAssertTrue(r.updates.isEmpty)
        XCTAssertEqual(r.breakdown?.id, "a1")
    }

    func testHeaderDrops() {
        let up = Dictionary(uniqueKeysWithValues: planningDrop(4, 2, list(), isOld: never).updates.map { ($0.id, $0) })
        XCTAssertEqual(up["a2"]?.date, "02")
        XCTAssertEqual(["a2", "a3", "b1", "b2"].map { up[$0]?.order ?? -9 }, [0, 1, 2, 3])
        XCTAssertNil(up["a1"])
        let down = Dictionary(uniqueKeysWithValues: planningDrop(4, list().count - 1, list(), isOld: never).updates.map { ($0.id, $0) })
        XCTAssertEqual(down["b1"]?.date, "01")
        XCTAssertEqual(down["b1"]?.order, 3)
        XCTAssertEqual(down["b2"]?.order, 4)
        let month = planningDrop(1, 3, [.title(a), todo("a1", a, 0), .title("2030-02"), todo("m1", "2030-02", 0)], isOld: never).updates.first!
        XCTAssertNil(month.date)
        XCTAssertEqual(month.monthAndYear, "2030-02")
    }

    // endregion

    // region Sync merge (outbox + remote apply)

    func testLocalEditsQueueOnlyChangedFields() {
        let todo = Todo(text: "write report", monthAndYear: "2030-01", date: "05")
        Db.shared.saveTodos([todo])
        XCTAssertTrue(Set(Db.shared.outbox().map(\.field)).isSuperset(of: ["text", "monthAndYear", "date", "completed"]))
        Db.shared.acknowledge(Db.shared.outbox())
        let loaded = Db.shared.todo(todo.id)!
        Db.shared.updateTodo(loaded) { $0.completed = true }
        XCTAssertEqual(Db.shared.outbox().map(\.field), ["completed"])
        XCTAssertEqual(Db.shared.outbox().first?.value as? Bool, true)
    }

    func testRemoteChangesKeepPendingLocalFields() {
        let todo = Todo(text: "local text", monthAndYear: "2030-01", date: "05")
        Db.shared.saveTodos([todo])
        Db.shared.acknowledge(Db.shared.outbox())
        Db.shared.updateTodo(Db.shared.todo(todo.id)!) { $0.text = "edited offline" }
        // Another device completed it and changed the text; the text edit here is still waiting to be pushed
        Db.shared.write { Db.shared.applyRemote(TodoEntity, ["id": todo.id, "text": "from server", "completed": true]) }
        let merged = Db.shared.todo(todo.id)!
        XCTAssertEqual(merged.text, "edited offline")
        XCTAssertTrue(merged.completed)
        // Once acknowledged, the server's value wins again
        Db.shared.acknowledge(Db.shared.outbox())
        Db.shared.write { Db.shared.applyRemote(TodoEntity, ["id": todo.id, "text": "from server"]) }
        XCTAssertEqual(Db.shared.todo(todo.id)!.text, "from server")
    }

    func testSaveDoesNotOverwriteFieldsSyncedMeanwhile() {
        let todo = Todo(text: "a", monthAndYear: "2030-01", date: "05")
        Db.shared.saveTodos([todo])
        Db.shared.acknowledge(Db.shared.outbox())
        let loaded = Db.shared.todo(todo.id)!
        Db.shared.write { Db.shared.applyRemote(TodoEntity, ["id": todo.id, "frog": true]) }
        loaded.text = "b"
        Db.shared.saveTodos([loaded])
        let row = Db.shared.todo(todo.id)!
        XCTAssertEqual(row.text, "b")
        XCTAssertTrue(row.frog)
    }

    func testNewerEditStaysQueuedAfterOlderAck() {
        Db.shared.enqueue(Change(collection: "todo", id: "x", field: "text", value: "1", at: 1))
        let sent = Db.shared.outbox()
        Db.shared.enqueue(Change(collection: "todo", id: "x", field: "text", value: "2", at: 2))
        Db.shared.acknowledge(sent)
        XCTAssertEqual(Db.shared.outbox().map { $0.value as? String }, ["2"])
    }

    // endregion
}
