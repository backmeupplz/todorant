import Foundation

/// A typed server address → its base URL (http or https, https when left out; no trailing slash), nil when it isn't one
func serverUrl(_ input: String) -> String? {
    let trimmed = input.trimmingCharacters(in: .whitespaces)
    guard let c = URLComponents(string: trimmed.contains("://") ? trimmed : "https://\(trimmed)"),
          let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let host = c.host?.lowercased(), !host.isEmpty, c.query == nil, c.fragment == nil else { return nil }
    let port = c.port.flatMap { ($0 == 443 && scheme == "https") || ($0 == 80 && scheme == "http") ? nil : ":\($0)" } ?? ""
    let path = c.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return "\(scheme)://\(host)\(port)\(path.isEmpty ? "" : "/\(path)")"
}

/// REST endpoints of the backend used by the app (rest.ts)
enum Rest {
    /// todorant's own server; QA builds can point elsewhere with the API launch argument
    static let API = UserDefaults.standard.string(forKey: "API") ?? "https://backend.todorant.com"

    /// A self-hosted server picked by the user, nil for todorant's own
    static var server: String? {
        get { Prefs.string("server") }
        set { Prefs.shared.set("server", newValue) }
    }
    static var base: String { server ?? API }

    static let http: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        return URLSession(configuration: config)
    }()

    struct HttpError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    @discardableResult
    private static func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, token: String? = Session.user?.token) async throws -> Data {
        var request = URLRequest(url: URL(string: "\(base)\(path)")!)
        request.httpMethod = method
        if let token { request.setValue(token, forHTTPHeaderField: "token") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) {
            // v1 answers {message}, v2 {error}
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = [json?["message"], json?["error"]].compactMap { $0 as? String }.first { !$0.isEmpty }
            throw HttpError(message: message ?? "Request failed with status code \(status)")
        }
        return data
    }

    private static func object(_ data: Data) throws -> [String: Any] {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw HttpError(message: "Invalid response") }
        return json
    }

    private static func login(_ provider: String, _ body: [String: Any]) async throws -> User {
        User(json: try object(try await call("POST", "/v2/auth/\(provider)", body, token: nil)))
    }

    /// Sign in with Apple on iOS: the backend redeems the authorization code with client id com.todorant.app.
    /// [name] is only there the first time a user signs in (Apple sends it once).
    static func loginApple(code: String, name: PersonNameComponents?, email: String?) async throws -> User {
        var body: [String: Any] = ["client": "ios", "code": code]
        if let name, name.givenName != nil || name.familyName != nil {
            // The backend reads user.name.firstName and .lastName
            body["user"] = ["name": ["firstName": name.givenName ?? "", "lastName": name.familyName ?? ""], "email": (email as Any?) ?? NSNull()]
        }
        return try await login("apple", body)
    }

    static func loginToken(_ token: String) async throws -> User { try await login("token", ["token": token]) }

    /// Email + password: signs in, or creates the account with [signup]
    static func loginPassword(_ email: String, _ password: String, signup: Bool) async throws -> User {
        try await login(signup ? "signup" : "password", ["email": email.trimmingCharacters(in: .whitespaces), "password": password])
    }

    static func setQrToken(_ uuid: String) async throws { try await call("POST", "/login/qr_token", ["uuid": uuid]) }

    static func sendData(_ data: [String: Any]) async throws { try await call("POST", "/data", ["data": data]) }

    static func resetDelegateToken() async throws -> String {
        try object(try await call("POST", "/v2/delegation/token", [:]))["token"] as? String ?? ""
    }

    static func acceptInvite(_ invite: String) async throws { try await call("POST", "/v2/delegation/accept", ["token": invite]) }

    /// Deletes the account and everything in it on the server
    static func deleteAccount() async throws { try await call("DELETE", "/v2/account") }

    static func removeDelegation(_ userId: String, isDelegator: Bool) async throws {
        try await call("DELETE", "/v2/delegation/\(isDelegator ? "delegators" : "delegates")/\(userId)")
    }
}
