import XCTest

/// QA flows against a local backend. Each test is independent; run one with -only-testing:UITests/QA/<name>.
final class QA: TodorantUITest {
    /// Sign up by email in the UI, add todos, complete one
    func testSignupAndTodos() {
        launch()
        tab("Settings")
        shot("01-settings-anon")
        tap(button("Login"))
        let email = app.textFields["email"]
        tap(email)
        email.typeText(env["EMAIL"] ?? "qa+ui\(Int(Date().timeIntervalSince1970))@example.com")
        tap(app.secureTextFields["password"])
        app.secureTextFields["password"].typeText("password123")
        shot("02-login")
        tap(button("Create account"))
        dismissSavePassword()
        wait(button("Logout"), timeout: 30)
        shot("03-settings-user")
        tab("Current")
        tap(app.buttons["plus"])
        addTodo("Buy oat milk #groceries")
        tap(app.buttons["plus"])
        addTodo("Call the dentist", frog: true)
        wait(containing("Call the dentist"))
        shot("04-current")
        // The frog goes first; completing it shows the next one
        tap(button("Completed"))
        wait(containing("Buy oat milk"))
        shot("05-current-after-complete")
        tab("Planning")
        shot("06-planning")
        tap(app.segmentedControls.buttons["Completed"])
        wait(containing("Call the dentist"))
        shot("07-completed")
    }

    /// Another device's edits arrive live; edits made while the server is down go out when it's back
    func testLiveAndOffline() {
        launch(token: env["TOKEN"])
        wait(text("To infinity!"), timeout: 30)
        let today = todayString()
        let id = String(format: "%08x", Int(Date().timeIntervalSince1970)) + "0000000000000001"
        rest("POST", "/v2/todos", ["id": id, "text": "Live from another device", "monthAndYear": String(today.prefix(7)), "date": String(today.suffix(2)), "order": 0])
        wait(containing("Live from another device"), timeout: 10)
        shot("10-live-added")
        rest("PATCH", "/v2/todos/\(id)", ["text": "Edited on the web"])
        wait(containing("Edited on the web"), timeout: 10)
        shot("11-live-edited")
        handshake("need-offline", "offline")
        sleep(3)
        tap(button("Completed"))
        tap(app.buttons["plus"])
        addTodo("Written offline")
        wait(containing("Written offline"))
        shot("12-offline")
        handshake("need-online", "online")
        let deadline = Date().addingTimeInterval(60)
        var synced = false
        while Date() < deadline && !synced {
            let done = (rest("GET", "/v2/todos?completed=true") as? [String: Any])?["todos"] as? [[String: Any]] ?? []
            let open = (rest("GET", "/v2/todos") as? [String: Any])?["todos"] as? [[String: Any]] ?? []
            synced = done.contains { $0["id"] as? String == id } && open.contains { $0["text"] as? String == "Written offline" }
            if !synced { sleep(2) }
        }
        XCTAssertTrue(synced, "offline edits reached the server")
        shot("13-online")
    }
}
