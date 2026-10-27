import XCTest

/// Size-class layouts and folding mid-edit, on whichever simulator runs them (iPhone, iPad, iPhone Duo folded or unfolded).
/// Env (TEST_RUNNER_ prefix): SHOTS, MODE (light or dark), RTL (YES forces right-to-left), PREFIX (screenshot names).
final class FoldLayout: TodorantUITest {
    private let typed = "Fold test #duo"

    private func start(_ extra: [String] = []) {
        var args = ["-qaColorMode", env["MODE"] ?? "light"] + extra
        if env["RTL"] == "YES" { args += ["-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"] }
        launch(args)
    }

    /// Wide enough for the add screen to sit next to the tabs when the size class is regular
    private var wide: Bool { app.windows.firstMatch.frame.width >= 600 }

    /// The size class the app lays out with, as if the device folded (compact) or unfolded (regular)
    private func fold(_ sizeClass: String) {
        // Through the system, so the running app gets the link (XCUIApplication.open relaunches it)
        XCUIDevice.shared.system.open(URL(string: "todorant://qa-size-class?value=\(sizeClass)")!)
        let open = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if open.waitForExistence(timeout: 2) { open.tap() }
        XCTAssertEqual(app.state, .runningForeground)
        sleep(2)
    }

    private func tabAt(_ title: String) {
        let bar = app.tabBars.buttons[title]
        tap(bar.waitForExistence(timeout: 3) ? bar : app.buttons[title].firstMatch)
    }

    /// The typed text, the picked day and the keyboard stay through folds in both directions. The editor moves between the
    /// sheet and the column only where the window is wide (iPad, unfolded Duo); narrower, this checks the sheet keeps them.
    func testFoldKeepsDraft() {
        start(["-qaSizeClass", "regular"])
        tabAt("Planning")
        tap(app.buttons["plus"])
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.tap()
        field.typeText(typed)
        pickDay(todayString())
        // Side by side when there's room: the list's own + button stays reachable while editing
        XCTAssertEqual(app.buttons["plus"].isHittable, wide)
        for sizeClass in ["compact", "regular", "compact", "regular"] {
            fold(sizeClass)
            wait(field)
            XCTAssertEqual(field.value as? String, typed, "text after \(sizeClass)")
            XCTAssertEqual(app.buttons["dateRow"].firstMatch.label, todayString(), "day after \(sizeClass)")
            XCTAssertEqual(app.buttons["plus"].isHittable, sizeClass == "regular" && wide, "layout after \(sizeClass)")
        }
        // The keyboard comes back to the same form: typing goes on without tapping it (the tap puts the cursor at the end)
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        fold("compact")
        app.typeText(" A")
        fold("regular")
        app.typeText("B")
        XCTAssertEqual(field.value as? String, "\(typed) AB")
        tap(app.buttons["saveTodos"])
        wait(containing("\(typed) AB"))
        // The sheet may still be sliding away when the new todo shows behind it
        XCTAssertTrue(field.waitForNonExistence(timeout: 3))
    }

    /// Side by side the list stays usable: editing another todo asks about the unsaved one first, never drops it silently
    func testOtherTodoAsksFirst() throws {
        start(["-qaSizeClass", "regular"])
        try XCTSkipUnless(wide, "the add screen is a sheet here, so the list behind it can't be used")
        tabAt("Planning")
        tap(app.buttons["plus"])
        let saved = "Saved \(Int(Date().timeIntervalSince1970))"
        addTodo(saved)
        tap(app.buttons["plus"])
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.tap()
        field.typeText("Unsaved")
        // Opens the saved todo's actions, then its editor
        tap(containing(saved))
        tap(button("Edit todo"))
        tap(button("Fix task"))
        XCTAssertEqual(field.value as? String, "Unsaved")
        tap(button("Edit todo"))
        tap(button("Dismiss task"))
        sleep(1)
        XCTAssertEqual(field.value as? String, saved)
    }

    /// Current, planning and the add screen over planning in this run's device, size class, mode, text size and direction
    func testShots() {
        start()
        let p = env["PREFIX"] ?? "layout"
        tap(app.buttons["plus"])
        addTodo("Call Mom about the weekend")
        shot("\(p)-1-current")
        tabAt("Planning")
        // Current shows one todo at a time, which may be another test's
        wait(containing("Call Mom about the weekend"))
        shot("\(p)-2-planning")
        tap(app.buttons["plus"])
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.typeText("Plan the trip #travel")
        tap(app.buttons["dateRow"].firstMatch)
        shot("\(p)-3-add")
    }
}
