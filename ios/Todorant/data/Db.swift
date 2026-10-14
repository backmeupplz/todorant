import Foundation
import Observation
import SQLite3

/// Mongo ObjectIds made on the device: the server stores todos under the ids clients give them
enum Ids {
    private static var counter = UInt32.random(in: 0...UInt32.max)

    /// Time, 5 fresh random bytes, counter: one id says nothing about the device's other ids
    static func new() -> String {
        var bytes = (0..<12).map { _ in UInt8.random(in: 0...255) }
        let seconds = UInt32(Date().timeIntervalSince1970)
        for i in 0..<4 { bytes[i] = UInt8(truncatingIfNeeded: seconds >> (24 - 8 * UInt32(i))) }
        counter &+= 1
        for i in 0..<3 { bytes[9 + i] = UInt8(truncatingIfNeeded: counter >> (16 - 8 * UInt32(i))) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

/// A synced document. [base] holds the values it was loaded with, to know what a save changed.
protocol Doc: AnyObject {
    var id: String { get }
    var base: Self? { get set }
}

final class Todo: Doc {
    var id: String
    var text: String
    var completed: Bool
    var frog: Bool
    var frogFails: Int
    var skipped: Bool
    var order: Double
    var monthAndYear: String?
    var date: String?
    var time: String?
    var deleted: Bool
    var encrypted: Bool
    var repetitive: Bool
    var delegateAccepted: Bool?
    /// Server id of the owner (the delegate for delegated todos)
    var userId: String?
    /// Server id of the delegator, nil for own todos
    var delegatorId: String?
    var createdAt: Int
    var updatedAt: Int
    /// Local only: UTC midnight of the day (or month), for sorting
    var exactDate: Int?
    var base: Todo?

    init(
        id: String = Ids.new(), text: String = "", completed: Bool = false, frog: Bool = false, frogFails: Int = 0,
        skipped: Bool = false, order: Double = 0, monthAndYear: String? = nil, date: String? = nil, time: String? = nil,
        deleted: Bool = false, encrypted: Bool = false, repetitive: Bool = false, delegateAccepted: Bool? = nil,
        userId: String? = nil, delegatorId: String? = nil, createdAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        updatedAt: Int = 0, exactDate: Int? = nil
    ) {
        self.id = id; self.text = text; self.completed = completed; self.frog = frog; self.frogFails = frogFails
        self.skipped = skipped; self.order = order; self.monthAndYear = monthAndYear; self.date = date; self.time = time
        self.deleted = deleted; self.encrypted = encrypted; self.repetitive = repetitive; self.delegateAccepted = delegateAccepted
        self.userId = userId; self.delegatorId = delegatorId; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.exactDate = exactDate
    }

    /// getTitle() from the RN app: "YYYY-MM" or "YYYY-MM-DD"
    var title: String { "\(monthAndYear ?? "")\(date.map { $0.isEmpty ? "" : "-\($0)" } ?? "")" }

    /// Kotlin's data class copy: same values, the same base
    func copy() -> Todo {
        let copy = TodoEntity.copy(self)
        copy.base = base
        return copy
    }
}

final class Tag: Doc {
    var id: String
    var tag: String
    var color: String?
    var deleted: Bool
    var epic: Bool
    var epicCompleted: Bool
    var epicGoal: Int
    var epicPoints: Int
    var epicOrder: Int
    var numberOfUses: Int
    var createdAt: Int
    var updatedAt: Int
    var base: Tag?

    init(
        id: String = Ids.new(), tag: String = "", color: String? = nil, deleted: Bool = false, epic: Bool = false,
        epicCompleted: Bool = false, epicGoal: Int = 0, epicPoints: Int = 0, epicOrder: Int = 0, numberOfUses: Int = 0,
        createdAt: Int = Int(Date().timeIntervalSince1970 * 1000), updatedAt: Int = 0
    ) {
        self.id = id; self.tag = tag; self.color = color; self.deleted = deleted; self.epic = epic
        self.epicCompleted = epicCompleted; self.epicGoal = epicGoal; self.epicPoints = epicPoints; self.epicOrder = epicOrder
        self.numberOfUses = numberOfUses; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
}

/// A delegate or a delegator (from the server's delegation snapshot)
struct DelegationUser: Hashable {
    let id: String
    let name: String?
    let isDelegator: Bool
}

enum Kind { case text, int, real, bool }

/// Values are String, Int, Double, Bool or nil; equal when the same kind holds the same value
func same(_ a: Any?, _ b: Any?) -> Bool { (a as? AnyHashable) == (b as? AnyHashable) }

/// A column. [synced] fields travel to the server; column and wire names are the same.
struct Field<T: AnyObject> {
    let name: String
    let kind: Kind
    let synced: Bool
    let get: (T) -> Any?
    let set: (T, Any?) -> Void

    init<V>(_ name: String, _ kind: Kind, _ path: ReferenceWritableKeyPath<T, V>, synced: Bool = true) {
        self.name = name; self.kind = kind; self.synced = synced
        get = { $0[keyPath: path] }
        set = { doc, value in doc[keyPath: path] = value as! V }
    }

    init<V>(_ name: String, _ kind: Kind, _ path: ReferenceWritableKeyPath<T, V?>, synced: Bool = true) {
        self.name = name; self.kind = kind; self.synced = synced
        get = { $0[keyPath: path] }
        set = { doc, value in doc[keyPath: path] = value.map { $0 as! V } }
    }

    func read(_ stmt: OpaquePointer, _ index: Int32) -> Any? {
        if sqlite3_column_type(stmt, index) == SQLITE_NULL { return nil }
        switch kind {
        case .text: return String(cString: sqlite3_column_text(stmt, index))
        case .int: return Int(sqlite3_column_int64(stmt, index))
        case .real: return sqlite3_column_double(stmt, index)
        case .bool: return sqlite3_column_int64(stmt, index) != 0
        }
    }

    func fromJson(_ json: [String: Any]) -> Any? {
        guard let value = json[name], !(value is NSNull) else { return nil }
        switch kind {
        case .text: return value as? String
        case .int: return (value as? NSNumber)?.intValue
        case .real: return (value as? NSNumber)?.doubleValue
        case .bool: return (value as? NSNumber)?.boolValue
        }
    }
}

/// Everything about a collection, defined once: table, wire name, columns, defaults
final class Entity<T: Doc> {
    let table: String
    let collection: String
    let fields: [Field<T>]
    let synced: [Field<T>]
    private let factory: () -> T
    private let defaults: [String: Any]
    /// Local-only columns derived from synced ones
    let prepare: (T) -> Void

    init(_ table: String, _ collection: String, _ factory: @escaping () -> T, prepare: @escaping (T) -> Void = { _ in }, fields: [Field<T>]) {
        self.table = table; self.collection = collection; self.factory = factory; self.fields = fields; self.prepare = prepare
        synced = fields.filter(\.synced)
        let d = factory()
        var defaults = [String: Any]()
        for f in fields { if let v = f.get(d) { defaults[f.name] = v } }
        self.defaults = defaults
    }

    func new() -> T { factory() }
    func copy(_ doc: T) -> T {
        let copy = factory()
        for f in fields { f.set(copy, f.get(doc)) }
        return copy
    }
    func equal(_ a: T, _ b: T) -> Bool { fields.allSatisfy { same($0.get(a), $0.get(b)) } }

    /// Server value or nil → the property (nils become defaults for non-optional properties)
    func assign(_ doc: T, _ field: Field<T>, _ value: Any?) { field.set(doc, value ?? defaults[field.name]) }

    func createSql() -> String {
        "CREATE TABLE \(table) (" + fields.map { f in
            "\"\(f.name)\" " + (f.name == "id" ? "TEXT PRIMARY KEY" : f.kind == .text ? "TEXT" : f.kind == .real ? "REAL" : "INTEGER")
        }.joined(separator: ", ") + ")"
    }

    func read(_ stmt: OpaquePointer) -> T {
        let doc = factory()
        for (i, field) in fields.enumerated() { assign(doc, field, field.read(stmt, Int32(i))) }
        doc.base = copy(doc)
        return doc
    }

    /// Every column as JSON (exports, debugging)
    func toJson(_ doc: T) -> [String: Any] {
        var json = [String: Any]()
        for f in fields { json[f.name] = f.get(doc) ?? NSNull() }
        return json
    }

    var columns: String { fields.map { "\"\($0.name)\"" }.joined(separator: ", ") }
}

let TodoEntity = Entity<Todo>("todos", "todo", { Todo() }, prepare: { $0.exactDate = exactDate($0.title) }, fields: [
    Field("id", .text, \Todo.id, synced: false),
    Field("text", .text, \Todo.text),
    Field("completed", .bool, \Todo.completed),
    Field("frog", .bool, \Todo.frog),
    Field("frogFails", .int, \Todo.frogFails),
    Field("skipped", .bool, \Todo.skipped),
    Field("order", .real, \Todo.order),
    Field("monthAndYear", .text, \Todo.monthAndYear),
    Field("date", .text, \Todo.date),
    Field("time", .text, \Todo.time),
    Field("deleted", .bool, \Todo.deleted),
    Field("encrypted", .bool, \Todo.encrypted),
    Field("repetitive", .bool, \Todo.repetitive),
    Field("delegateAccepted", .bool, \Todo.delegateAccepted),
    // Ownership is set when a todo is created (delegation) and never changes after
    Field("user", .text, \Todo.userId),
    Field("delegator", .text, \Todo.delegatorId),
    Field("createdAt", .int, \Todo.createdAt, synced: false),
    Field("updatedAt", .int, \Todo.updatedAt, synced: false),
    Field("exactDate", .int, \Todo.exactDate, synced: false),
])

let TagEntity = Entity<Tag>("tags", "tag", { Tag() }, fields: [
    Field("id", .text, \Tag.id, synced: false),
    Field("tag", .text, \Tag.tag),
    Field("color", .text, \Tag.color),
    Field("deleted", .bool, \Tag.deleted),
    Field("epic", .bool, \Tag.epic),
    Field("epicCompleted", .bool, \Tag.epicCompleted),
    Field("epicGoal", .int, \Tag.epicGoal),
    Field("epicPoints", .int, \Tag.epicPoints),
    Field("epicOrder", .int, \Tag.epicOrder),
    Field("numberOfUses", .int, \Tag.numberOfUses),
    Field("createdAt", .int, \Tag.createdAt, synced: false),
    Field("updatedAt", .int, \Tag.updatedAt, synced: false),
])

/// A pending local change of one field, waiting to be pushed
struct Change: Equatable {
    let collection: String
    let id: String
    let field: String
    let value: Any?
    let at: Int

    static func == (a: Change, b: Change) -> Bool {
        a.collection == b.collection && a.id == b.id && a.field == b.field && a.at == b.at && same(a.value, b.value)
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// The App Group container, shared with the widget; the app's own folder when signing has no group
let sharedContainer: URL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.todorant.app")
    ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]

@Observable
final class Db {
    static let shared = Db()

    @ObservationIgnored private var db: OpaquePointer?

    /// Bumped after every write; queries read it, so views showing them re-render
    private(set) var changes = 0

    /// Called after every committed write (the widget and badge follow the data)
    @ObservationIgnored static var onWrite: () -> Void = {}

    /// Called after local changes are queued (the sync engine pushes them)
    @ObservationIgnored static var onLocalChange: () -> Void = {}

    /// Server clock, so edit times are comparable across devices (set by the sync engine)
    @ObservationIgnored static var now: () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }

    /// Opens (and creates) the database; ":memory:" for tests
    func open(_ path: String? = nil) {
        if db != nil { sqlite3_close(db) }
        let file = path ?? {
            try? FileManager.default.createDirectory(at: sharedContainer, withIntermediateDirectories: true)
            return sharedContainer.appendingPathComponent("todorant-v2.db").path
        }()
        sqlite3_open(file, &db)
        exec("PRAGMA journal_mode = WAL")
        if query("PRAGMA user_version", [], { sqlite3_column_int($0, 0) }).first == 0 {
            exec(TodoEntity.createSql())
            exec("CREATE INDEX todos_day ON todos (monthAndYear, date)")
            exec("CREATE INDEX todos_list ON todos (deleted, completed, exactDate)")
            exec(TagEntity.createSql())
            exec("CREATE TABLE users (id TEXT, name TEXT, isDelegator INTEGER, PRIMARY KEY (id, isDelegator))")
            exec("CREATE TABLE outbox (c TEXT, id TEXT, field TEXT, value TEXT, at INTEGER, PRIMARY KEY (c, id, field))")
            exec("PRAGMA user_version = 1")
        }
        changes += 1
    }

    /// Re-reads everything (the widget may have written while the app was in the background)
    func touch() { changes += 1 }

    // region SQLite

    private func prepare(_ sql: String, _ args: [Any?]) -> OpaquePointer? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            print("SQL error \(String(cString: sqlite3_errmsg(db))): \(sql)")
            return nil
        }
        for (i, arg) in args.enumerated() {
            let index = Int32(i + 1)
            switch arg {
            case nil: sqlite3_bind_null(stmt, index)
            case let v as String: sqlite3_bind_text(stmt, index, v, -1, SQLITE_TRANSIENT)
            case let v as Bool: sqlite3_bind_int64(stmt, index, v ? 1 : 0)
            case let v as Int: sqlite3_bind_int64(stmt, index, Int64(v))
            case let v as Double: sqlite3_bind_double(stmt, index, v)
            default: fatalError("Unsupported argument \(String(describing: arg))")
            }
        }
        return stmt
    }

    func exec(_ sql: String, _ args: [Any?] = []) {
        guard let stmt = prepare(sql, args) else { return }
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
    }

    func query<R>(_ sql: String, _ args: [Any?], _ read: (OpaquePointer) -> R) -> [R] {
        _ = changes
        guard let stmt = prepare(sql, args) else { return [] }
        var rows = [R]()
        while sqlite3_step(stmt) == SQLITE_ROW { rows.append(read(stmt)) }
        sqlite3_finalize(stmt)
        return rows
    }

    private var depth = 0

    /// A transaction; nested calls join the outer one
    @discardableResult
    func write<R>(_ block: () -> R) -> R {
        if depth == 0 { exec("BEGIN") }
        depth += 1
        defer {
            depth -= 1
            if depth == 0 {
                exec("COMMIT")
                changes += 1
                Db.onWrite()
            }
        }
        return block()
    }

    func clear() { write { for t in ["todos", "tags", "users", "outbox"] { exec("DELETE FROM \(t)") } } }

    func count(_ table: String, _ where: String, _ args: [Any?] = []) -> Int {
        query("SELECT COUNT(*) FROM \(table) WHERE \(`where`)", args) { Int(sqlite3_column_int64($0, 0)) }.first ?? 0
    }

    func query<T: Doc>(_ entity: Entity<T>, _ where: String = "1", _ args: [Any?] = [], orderBy: String? = nil, limit: Int? = nil) -> [T] {
        var sql = "SELECT \(entity.columns) FROM \(entity.table) WHERE \(`where`)"
        if let orderBy { sql += " ORDER BY \(orderBy)" }
        if let limit { sql += " LIMIT \(limit)" }
        return query(sql, args, entity.read)
    }

    func get<T: Doc>(_ entity: Entity<T>, _ id: String?) -> T? {
        guard let id else { return nil }
        return query(entity, "id = ?", [id]).first
    }

    // endregion

    /**
     * Saves local edits like WatermelonDB's record.update: only the fields changed since the doc was
     * loaded go onto the current row (a sync that landed meanwhile isn't overwritten), and each of them
     * is queued for the server with its edit time. New docs (no [Doc.base]) queue every synced field.
     */
    func save<T: Doc>(_ entity: Entity<T>, _ docs: [T]) {
        if docs.isEmpty { return }
        let at = Db.now()
        write {
            for doc in docs {
                let base = doc.base
                let current = base != nil ? get(entity, doc.id) : nil
                // New docs send everything that's set, edits only what changed
                var changed = entity.synced.filter { f in base.map { !same(f.get(doc), f.get($0)) } ?? (f.get(doc) != nil) }
                // A todo switching encryption has to send its text again
                if entity.table == TodoEntity.table, changed.contains(where: { $0.name == "encrypted" }), !changed.contains(where: { $0.name == "text" }) {
                    changed += entity.synced.filter { $0.name == "text" }
                }
                let row = current ?? entity.copy(doc)
                for f in changed { f.set(row, f.get(doc)) }
                writeLocal(entity, row)
                for f in changed { enqueue(Change(collection: entity.collection, id: doc.id, field: f.name, value: f.get(row), at: at)) }
                entity.fields.forEach { $0.set(doc, $0.get(row)) }
                doc.base = entity.copy(row)
            }
        }
        Db.onLocalChange()
    }

    /// Queues every field of every document again, as if all were new (the Data screen's re-push)
    func pushAgain<T: Doc>(_ entity: Entity<T>) { save(entity, query(entity).map { $0.base = nil; return $0 }) }

    /// Rewrites a row's local-only columns (no sync). Call inside [write].
    func writeLocal<T: Doc>(_ entity: Entity<T>, _ doc: T) {
        entity.prepare(doc)
        let marks = Array(repeating: "?", count: entity.fields.count).joined(separator: ", ")
        exec("INSERT OR REPLACE INTO \(entity.table) (\(entity.columns)) VALUES (\(marks))", entity.fields.map { $0.get(doc) })
    }

    func edit<T: Doc>(_ entity: Entity<T>, _ doc: T, _ change: (T) -> Void) {
        change(doc)
        save(entity, [doc])
    }

    /**
     * Applies a server version of a document. Fields with local changes still waiting to be pushed keep
     * their local values (the server resolves them when they arrive). Call inside [write].
     */
    func applyRemote<T: Doc>(_ entity: Entity<T>, _ json: [String: Any]) {
        guard let id = json["id"] as? String, !id.isEmpty else { return }
        let pending = pendingFields(entity.collection, id)
        let doc = get(entity, id) ?? {
            let doc = entity.new()
            entity.fields.first { $0.name == "id" }!.set(doc, id)
            return doc
        }()
        for f in entity.fields where f.name != "id" && json[f.name] != nil && !pending.contains(f.name) {
            entity.assign(doc, f, f.fromJson(json))
        }
        writeLocal(entity, doc)
    }

    // region Outbox

    private func encode(_ value: Any?) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [value ?? NSNull()]), encoding: .utf8)!
    }

    private func decode(_ text: String) -> Any? {
        let value = (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any])?.first
        return value is NSNull ? nil : value
    }

    /// Queues a change; a newer change of the same field replaces the older one
    func enqueue(_ change: Change) {
        exec("INSERT OR REPLACE INTO outbox (c, id, field, value, at) VALUES (?, ?, ?, ?, ?)",
             [change.collection, change.id, change.field, encode(change.value), change.at])
    }

    func outbox() -> [Change] {
        query("SELECT c, id, field, value, at FROM outbox ORDER BY at", []) { s in
            Change(collection: String(cString: sqlite3_column_text(s, 0)), id: String(cString: sqlite3_column_text(s, 1)),
                   field: String(cString: sqlite3_column_text(s, 2)), value: decode(String(cString: sqlite3_column_text(s, 3))),
                   at: Int(sqlite3_column_int64(s, 4)))
        }
    }

    func pendingFields(_ collection: String, _ id: String) -> Set<String> {
        Set(query("SELECT field FROM outbox WHERE c = ? AND id = ?", [collection, id]) { String(cString: sqlite3_column_text($0, 0)) })
    }

    /// The server has these changes (or rejected them for good); newer edits of the same fields stay queued
    func acknowledge(_ sent: [Change]) {
        for c in sent { exec("DELETE FROM outbox WHERE c = ? AND id = ? AND field = ? AND at <= ?", [c.collection, c.id, c.field, c.at]) }
    }

    // endregion

    // region Typed helpers

    static let UNDELETED = "deleted = 0"

    func todos(_ where: String = "1", _ args: [Any?] = [], orderBy: String? = nil, limit: Int? = nil) -> [Todo] {
        query(TodoEntity, `where`, args, orderBy: orderBy, limit: limit)
    }

    func todo(_ id: String?) -> Todo? { get(TodoEntity, id) }
    func tag(_ id: String?) -> Tag? { get(TagEntity, id) }
    func tags(_ where: String = "1", _ args: [Any?] = [], orderBy: String? = nil) -> [Tag] { query(TagEntity, `where`, args, orderBy: orderBy) }

    /// Same sort as TagStore.undeletedTags
    func undeletedTags(_ where: String = "1", _ args: [Any?] = []) -> [Tag] {
        tags("deleted = 0 AND (\(`where`))", args, orderBy: "epic DESC, epicOrder ASC, numberOfUses DESC, tag ASC")
    }

    func epics() -> [Tag] { undeletedTags("epic = 1") }

    func updateTodo(_ todo: Todo, _ change: (Todo) -> Void) { edit(TodoEntity, todo, change) }
    func saveTodos(_ todos: [Todo]) { save(TodoEntity, todos) }
    func updateTag(_ tag: Tag, _ change: (Tag) -> Void) { edit(TagEntity, tag, change) }

    func users(_ isDelegator: Bool) -> [DelegationUser] {
        query("SELECT id, name FROM users WHERE isDelegator = ? ORDER BY name COLLATE NOCASE", [isDelegator]) { s in
            DelegationUser(id: String(cString: sqlite3_column_text(s, 0)),
                           name: sqlite3_column_type(s, 1) == SQLITE_NULL ? nil : String(cString: sqlite3_column_text(s, 1)),
                           isDelegator: isDelegator)
        }
    }

    func delegates() -> [DelegationUser] { users(false) }
    func delegators() -> [DelegationUser] { users(true) }
    func userName(_ id: String?, isDelegator: Bool) -> String? { id.flatMap { id in users(isDelegator).first { $0.id == id }?.name } }

    /// Replaces the delegation lists with the server's snapshot. Call inside [write].
    func replaceUsers(_ delegates: [DelegationUser], _ delegators: [DelegationUser]) {
        exec("DELETE FROM users")
        for u in delegates + delegators { exec("INSERT OR REPLACE INTO users (id, name, isDelegator) VALUES (?, ?, ?)", [u.id, u.name, u.isDelegator]) }
    }

    // endregion
}
