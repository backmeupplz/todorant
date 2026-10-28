import XCTest

/// App Store screenshots of a seeded account (see ../tour.sh). Env: TOKEN, LANG, FROG (a seeded text to wait for), ADD_TEXT,
/// FROG_LABEL (the add sheet's frog switch), SHOTS, DUO_INNER (see unfold).
final class Tour: TodorantUITest {
    private func start(_ mode: String) {
        let lang = env["LANG"] ?? "en"
        // The system language too, so the keyboard's spell check matches the typed text
        let system = ["pt-br": "pt-BR", "pt-pt": "pt-PT", "zh-hans": "zh-Hans", "zh-hant": "zh-Hant"][lang] ?? lang
        launch(["-qaLanguage", lang, "-qaColorMode", mode, "-AppleLanguages", "(\(system))"], token: env["TOKEN"])
    }

    /// Tabs by their translated titles (TABS: comma-separated); iPad shows them as a top bar and the iPhone Duo's cover
    /// display as a rail beside its status pill, not a UITabBar, and there a badge joins the label ("Delegation, 3")
    private func tabAt(_ i: Int) {
        let title = (env["TABS"] ?? "Current,Planning,Delegation,Settings").components(separatedBy: ",")[i]
        let bar = app.tabBars.buttons[title]
        tap(bar.waitForExistence(timeout: 3) ? bar : app.buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", title, title + ",")).firstMatch)
    }

    /// DUO_INNER=1: the iPhone Duo's inner display (landscape there). The test runner won't launch on an unfolded Duo, so
    /// the test starts folded and leaves an `unfold` file in SHOTS, which tour.sh answers by unfolding it and removing the file
    private func unfold() {
        let flag = "\(env["SHOTS"] ?? "/tmp/todorant-shots")/unfold"
        try? FileManager.default.createDirectory(atPath: (flag as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: flag, contents: nil)
        for _ in 0..<60 where FileManager.default.fileExists(atPath: flag) { sleep(1) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: flag), "tour.sh didn't unfold the Duo")
        sleep(3) // the switch to the inner display is animated
    }

    /// Waits for a seeded todo (env PLANNED: one planned for tomorrow, TO_ME: one delegated to the account) by its text
    /// before the tag, which the app draws as its own span
    private func waitFor(_ key: String) {
        guard let text = env[key]?.components(separatedBy: " #").first, !text.isEmpty else { return }
        wait(containing(text), timeout: 30)
    }

    func testTour() {
        start("light")
        if env["DUO_INNER"] == "1" { unfold() }
        wait(containing(env["FROG"] ?? ""), timeout: 40)
        sleep(2)
        shot("01-current", delay: 2)

        tabAt(1)
        waitFor("PLANNED")
        shot("02-planning", delay: 2)

        tap(app.buttons["plus"])
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.typeText(env["ADD_TEXT"] ?? "")
        XCTAssertEqual(field.value as? String, env["ADD_TEXT"], "the whole text arrived")
        tap(app.buttons["dateRow"].firstMatch)
        // marks it a frog (the row's switch holds the actual control)
        let frog = app.switches[env["FROG_LABEL"] ?? "It's a frog!"].firstMatch.switches.firstMatch
        tap(frog)
        XCTAssertEqual(frog.value as? String, "1", "the frog switch is on")
        shot("03-add", delay: 2)

        app.terminate()
        start("light")
        tabAt(2)
        waitFor("TO_ME")
        shot("04-delegation", delay: 2)

        app.terminate()
        start("dark")
        tabAt(1)
        waitFor("PLANNED")
        shot("05-dark", delay: 2)
        app.terminate()
        start("light")
    }
}
