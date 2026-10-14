import Foundation
import Network
import Observation

/// Ops per message: the server takes up to 5000, a long offline queue goes out in parts
private let MAX_OPS = 1000

/**
 * v2 sync over one WebSocket (`/v2/ws`): local edits are field changes in the outbox, pushed as soon as
 * they're made; the server resolves conflicts per field and streams other devices' changes back live.
 * A pull by cursor catches up after being offline. Everything runs on the main thread.
 */
@Observable
final class Sync: NSObject, URLSessionWebSocketDelegate {
    static let shared = Sync()

    private(set) var connected = false
    private(set) var connectionError: String?
    private var inFlight = 0
    var isSyncing: Bool { inFlight > 0 }

    /// Server time of the last pull, nil before the first (full) pull
    @ObservationIgnored private var cursor: Int? {
        get { Prefs.shared.defaults.object(forKey: "sync.cursor") as? Int }
        set { Prefs.shared.defaults.set(newValue, forKey: "sync.cursor") }
    }
    /// Server clock minus device clock
    @ObservationIgnored private var offset = 0

    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    @ObservationIgnored private var reconnectWork: DispatchWorkItem?
    @ObservationIgnored private var pushWork: DispatchWorkItem?
    @ObservationIgnored private var pingTimer: Timer?
    @ObservationIgnored private var awaitingPong = false
    @ObservationIgnored private var attempts = 0
    @ObservationIgnored private var requests = 0
    /// Outbox rows sent with each request, acknowledged when it's answered
    @ObservationIgnored private var sent = [Int: [Change]]()
    @ObservationIgnored private var waiting = [Int: CheckedContinuation<[String: Any], Error>]()
    @ObservationIgnored private let network = NWPathMonitor()

    struct SyncError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    func start() {
        Db.now = { [unowned self] in Int(Date().timeIntervalSince1970 * 1000) + offset }
        Db.onLocalChange = { [unowned self] in schedulePush() }
        var wasOnline = true
        network.pathUpdateHandler = { [unowned self] path in
            let online = path.status == .satisfied
            DispatchQueue.main.async { if online && !wasOnline { self.reconnect() }; wasOnline = online }
        }
        network.start(queue: .global())
        connect()
    }

    func connect() {
        guard let token = Session.user?.token, socket == nil else { return }
        // The token goes in a header: URLs end up in proxy logs
        let url = Rest.base.replacingOccurrences(of: "^http", with: "ws", options: .regularExpression) + "/v2/ws"
        var request = URLRequest(url: URL(string: url)!)
        request.setValue(token, forHTTPHeaderField: "token")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 64 * 1024 * 1024
        socket = task
        task.resume()
        receive(task)
        // Pings notice dead sockets (network switches) within seconds instead of minutes
        awaitingPong = false
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self, weak task] _ in
            guard let self, let task, task === self.socket else { return }
            if self.awaitingPong { task.cancel(with: .goingAway, reason: nil); return self.closed(task, "Ping timeout") }
            self.awaitingPong = true
            task.sendPing { _ in DispatchQueue.main.async { self.awaitingPong = false } }
        }
    }

    /// Connects right away (app resumed, network back), dropping a socket that never got going
    func reconnect() {
        reconnectWork?.cancel()
        attempts = 0
        if !connected {
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
        }
        connect()
    }

    func disconnect() {
        reconnectWork?.cancel()
        pingTimer?.invalidate()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connected = false
    }

    private func receive(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, task === self.socket else { return }
                switch result {
                case let .success(message):
                    let text: String? = switch message {
                    case let .string(s): s
                    case let .data(d): String(data: d, encoding: .utf8)
                    @unknown default: nil
                    }
                    if let text, let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] { self.handle(json) }
                    self.receive(task)
                case let .failure(error): self.closed(task, error.localizedDescription)
                }
            }
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        closed(webSocketTask, reason.flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 })
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let task = task as? URLSessionWebSocketTask { closed(task, error?.localizedDescription) }
    }

    private func closed(_ task: URLSessionWebSocketTask, _ error: String?) {
        guard task === socket else { return }
        socket = nil
        pingTimer?.invalidate()
        connected = false
        connectionError = error
        let failed = waiting
        waiting.removeAll()
        failed.values.forEach { $0.resume(throwing: SyncError(message: error ?? "Disconnected")) }
        sent.removeAll()
        inFlight = 0
        if Session.user == nil { return }
        // Exponential backoff up to 30 s; network and resume events reconnect sooner
        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.connect() }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + min(30, 0.5 * pow(2, Double(min(attempts, 6)))), execute: work)
        attempts += 1
    }

    private func handle(_ message: [String: Any]) {
        switch message["t"] as? String {
        case "hello":
            offset = ((message["now"] as? NSNumber)?.intValue ?? 0) - Int(Date().timeIntervalSince1970 * 1000)
            attempts = 0
            connected = true
            connectionError = nil
            Invites.all.forEach(acceptInvite)
            send(pull: true)
        case "synced":
            let rid = (message["rid"] as? NSNumber)?.intValue ?? 0
            inFlight = max(0, inFlight - 1)
            acknowledge(message["acks"] as? [[String: Any]], sent.removeValue(forKey: rid) ?? [])
            apply(message)
            waiting.removeValue(forKey: rid)?.resume(returning: message)
            let inBatches = sent.values.flatMap { $0 }
            if Db.shared.outbox().contains(where: { !inBatches.contains($0) }) { schedulePush() }
        case "changes": apply(message)
        case "pull": send(pull: true)
        case "error":
            let rid = (message["rid"] as? NSNumber)?.intValue ?? 0
            inFlight = max(0, inFlight - 1)
            sent.removeValue(forKey: rid)
            let text = message["message"] as? String ?? "Error"
            waiting.removeValue(forKey: rid)?.resume(throwing: SyncError(message: text))
            print("Sync: server error \(text)")
        default: break
        }
    }

    /// Sends the outbox, [MAX_OPS] at a time (and pulls the delta when [pull]); the answer goes to [waiter]
    @discardableResult
    private func send(pull: Bool = false, waiter: CheckedContinuation<[String: Any], Error>? = nil) -> Bool {
        guard let ws = socket, connected else { return false }
        let inBatches = sent.values.flatMap { $0 }
        let changes = groups(Db.shared.outbox().filter { !inBatches.contains($0) }).prefix(MAX_OPS).flatMap { $0 }
        if changes.isEmpty && !pull { return false }
        requests += 1
        let rid = requests
        var message: [String: Any] = ["t": "sync", "rid": rid]
        if !changes.isEmpty {
            message["ops"] = ops(changes)
            // The server needs the encryption password only to write todo texts to Google Calendar
            if Settings.googleCalendarCredentials != nil, let key = Session.encryptionKey { message["key"] = key }
        }
        if pull { message["since"] = cursor ?? 0 }
        sent[rid] = changes
        if let waiter { waiting[rid] = waiter }
        inFlight += 1
        let text = String(data: try! JSONSerialization.data(withJSONObject: message), encoding: .utf8)!
        ws.send(.string(text)) { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async { self?.closed(ws, error.localizedDescription) }
        }
        return true
    }

    /// Changes of one document made at one time, in outbox order
    private func groups(_ changes: [Change]) -> [[Change]] {
        var order = [String]()
        var byKey = [String: [Change]]()
        for c in changes {
            let key = "\(c.collection)\u{0}\(c.id)\u{0}\(c.at)"
            if byKey[key] == nil { order.append(key) }
            byKey[key, default: []].append(c)
        }
        return order.map { byKey[$0]! }
    }

    /// Field changes → ops, one per document and edit time; todo texts are encrypted on the way out
    private func ops(_ changes: [Change]) -> [[String: Any]] {
        let key = Session.encryptionKey
        return groups(changes).map { fields in
            let first = fields[0]
            var set = [String: Any]()
            for change in fields { set[change.field] = change.value ?? NSNull() }
            if first.collection == "todo", let key, let text = set["text"] as? String, !text.isEmpty {
                let encrypted = (set["encrypted"] as? Bool) ?? (Db.shared.todo(first.id)?.encrypted == true)
                if encrypted { set["text"] = Crypto.encrypt(text, key) }
            }
            var op: [String: Any] = ["c": first.collection, "at": first.at, "set": set]
            if !first.id.isEmpty { op["id"] = first.id }
            return op
        }
    }

    /// Answered changes leave the outbox; fields that lost to newer writes come back as fixes
    private func acknowledge(_ acks: [[String: Any]]?, _ batch: [Change]) {
        Db.shared.write { Db.shared.acknowledge(batch) }
        guard let acks else { return }
        var fixes = [String: Any]()
        for ack in acks {
            if let e = ack["e"] { print("Sync: rejected \(ack["c"] ?? "") \(ack["id"] ?? ""): \(e)") }
            guard var fix = ack["fix"] as? [String: Any] else { continue }
            switch ack["c"] as? String {
            case let c? where c == "todo" || c == "tag":
                fix["id"] = ack["id"]
                fixes["\(c)s"] = (fixes["\(c)s"] as? [[String: Any]] ?? []) + [fix]
            case "settings": fixes["user"] = ["settings": fix]
            case "hero": fixes["hero"] = fix
            default: break
            }
        }
        if !fixes.isEmpty { apply(fixes) }
    }

    /// Applies server data: documents, profile/settings, hero, delegation lists, cursor
    private func apply(_ message: [String: Any]) {
        let key = Session.encryptionKey
        func docs<T: Doc>(_ entity: Entity<T>, _ name: String) {
            for var json in message[name] as? [[String: Any]] ?? [] {
                // Deltas carry changed fields only, so a text edit may come without the encrypted flag
                if entity.table == TodoEntity.table, let key, let text = json["text"] as? String,
                   (json["encrypted"] as? Bool) ?? (Db.shared.todo(json["id"] as? String)?.encrypted == true),
                   let plain = Crypto.decrypt(text, key) {
                    json["text"] = plain
                }
                Db.shared.applyRemote(entity, json)
            }
        }
        Db.shared.write {
            docs(TodoEntity, "todos")
            docs(TagEntity, "tags")
            if let d = message["delegation"] as? [String: Any] {
                func users(_ name: String, _ isDelegator: Bool) -> [DelegationUser] {
                    (d[name] as? [[String: Any]] ?? []).compactMap { u in
                        (u["id"] as? String).map { DelegationUser(id: $0, name: u["name"] as? String ?? "", isDelegator: isDelegator) }
                    }
                }
                Db.shared.replaceUsers(users("delegates", false), users("delegators", true))
            }
        }
        if let profile = message["user"] as? [String: Any] {
            if profile["id"] != nil { Session.applyProfile(profile) } else if let settings = profile["settings"] as? [String: Any] { Settings.applyServer(settings) }
        }
        if let hero = message["hero"] as? [String: Any] {
            SyncedPref.apply("hero", hero)
            if let at = isoToMillis(hero["updatedAt"]), at > 0 { Hero.updatedAt = at }
        }
        if let c = message["cursor"] as? NSNumber { cursor = c.intValue }
        Widget.refresh()
    }

    /// Local changes go out after a short pause, so a burst of edits is one message
    func schedulePush() {
        pushWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            if self.socket == nil { self.connect() } else { self.send() }
        }
        pushWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.03, execute: work)
    }

    /// Pushes and pulls now, waiting for the answer (login, the Data screen); throws when offline
    func sync() async throws {
        connect()
        let deadline = Date().addingTimeInterval(30)
        while !connected {
            if Date() > deadline || Session.user == nil { throw SyncError(message: "Not connected") }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        _ = try await withCheckedThrowingContinuation { (c: CheckedContinuation<[String: Any], Error>) in
            if !send(pull: true, waiter: c) { return c.resume(throwing: SyncError(message: "Not connected")) }
            let rid = requests
            DispatchQueue.main.asyncAfter(deadline: .now() + max(1, deadline.timeIntervalSinceNow)) { [weak self] in
                self?.waiting.removeValue(forKey: rid)?.resume(throwing: SyncError(message: "Timed out"))
            }
        }
    }

    /// Pull everything again (Data screen)
    func hardSync() async throws {
        cursor = nil
        try await sync()
    }

    func login() async throws {
        cursor = nil
        disconnect()
        try await sync()
    }

    func logout() {
        disconnect()
        cursor = nil
    }

    /// Fire-and-forget push + pull
    func request() {
        Task { @MainActor in
            do { try await sync() } catch { print("Sync: \(error.localizedDescription)") }
        }
    }

    func acceptInvite(_ token: String) {
        Invites.add(token)
        Task { @MainActor in
            do {
                try await Rest.acceptInvite(token)
                Invites.remove(token)
            } catch let e as Rest.HttpError {
                Invites.remove(token)
                Ui.error(e)
            } catch {}
        }
    }
}
