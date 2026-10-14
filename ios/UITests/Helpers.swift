import XCTest

/// Shared steps for the QA flows and the screenshot tour. Env (TEST_RUNNER_ prefix): API, SHOTS, EMAIL, PASSWORD, TOKEN, LANG, MODE.
class TodorantUITest: XCTestCase {
    let env = ProcessInfo.processInfo.environment
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    func launch(_ extra: [String] = [], token: String? = nil, skipTutorial: Bool = true) {
        app.launchArguments = ["-API", env["API"] ?? "http://localhost:3310"] + (skipTutorial ? ["-qaSkipTutorial", "YES"] : []) + extra
        if let token { app.launchArguments += ["-qaToken", token] }
        app.launch()
    }

    func shot(_ name: String, delay: UInt32 = 1) {
        sleep(delay)
        let out = env["SHOTS"] ?? "/tmp/todorant-shots"
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
    }

    func wait(_ e: XCUIElement, timeout: Double = 15, line: UInt = #line) {
        if e.waitForExistence(timeout: timeout) { return }
        shot("zz-fail-\(line)", delay: 0)
        print(app.debugDescription)
        XCTFail("missing \(e)", line: line)
    }

    func tap(_ e: XCUIElement, timeout: Double = 15, line: UInt = #line) {
        wait(e, timeout: timeout, line: line)
        e.tap()
    }

    func button(_ label: String) -> XCUIElement { app.buttons[label].firstMatch }
    func text(_ label: String) -> XCUIElement { app.staticTexts[label].firstMatch }
    func containing(_ s: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch }

    /// The system offers to save the password after signing in
    func dismissSavePassword() {
        for a in [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")] where a.buttons["Not Now"].waitForExistence(timeout: 6) {
            a.buttons["Not Now"].tap()
            return
        }
    }

    func tab(_ name: String) { tap(app.tabBars.buttons[name].firstMatch) }

    /// Types a todo on the open add sheet, picks today and saves
    func addTodo(_ text: String, frog: Bool = false, day: String? = nil, save: Bool = true) {
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.tap()
        field.typeText(text)
        let dayRow = button("Select exact day")
        if dayRow.exists {
            dayRow.tap()
            tap(button(day ?? todayString()))
        }
        if frog { app.switches["It's a frog!"].firstMatch.switches.firstMatch.tap() }
        if save { tap(app.buttons["saveTodos"]) }
    }

    /// A second client: the v2 REST API with the account's token
    @discardableResult
    func rest(_ method: String, _ path: String, _ body: Any? = nil) -> Any? {
        var request = URLRequest(url: URL(string: (env["API"] ?? "http://localhost:3310") + path)!)
        request.httpMethod = method
        request.setValue(env["TOKEN"], forHTTPHeaderField: "token")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        var result: Any?
        let done = expectation(description: path)
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 20)
        return result
    }

    /// Choreography with the shell script driving the backend: writes [signal], waits for [answer]
    func handshake(_ signal: String, _ answer: String, timeout: Double = 120) {
        let dir = env["SIGNALS"] ?? "/tmp/todorant-signals"
        FileManager.default.createFile(atPath: "\(dir)/\(signal)", contents: nil)
        let deadline = Date().addingTimeInterval(timeout)
        while !FileManager.default.fileExists(atPath: "\(dir)/\(answer)") {
            if Date() > deadline { return XCTFail("no \(answer)") }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    func todayString() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }

    func dayString(_ offset: Int) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Calendar.current.date(byAdding: .day, value: offset, to: Date())!)
    }
}
