import XCTest

/// App Store screenshots of a seeded account (see ../tour.sh). Env: TOKEN, LANG, FROG (a seeded text to wait for), ADD_TEXT, SHOTS.
final class Tour: TodorantUITest {
    private func start(_ mode: String) {
        launch(["-qaLanguage", env["LANG"] ?? "en", "-qaColorMode", mode], token: env["TOKEN"])
    }

    /// Tabs by their translated titles (TABS: comma-separated); iPad shows them as a top bar, not a UITabBar
    private func tabAt(_ i: Int) {
        let title = (env["TABS"] ?? "Current,Planning,Delegation,Settings").components(separatedBy: ",")[i]
        let bar = app.tabBars.buttons[title]
        tap(bar.waitForExistence(timeout: 3) ? bar : app.buttons[title].firstMatch)
    }

    func testTour() {
        start("light")
        wait(containing(env["FROG"] ?? ""), timeout: 40)
        sleep(2)
        shot("01-current", delay: 2)

        tabAt(1)
        shot("02-planning", delay: 2)

        tap(app.buttons["plus"])
        let field = app.textFields["todoText"].firstMatch
        wait(field)
        field.typeText(env["ADD_TEXT"] ?? "")
        tap(app.buttons["dateRow"].firstMatch)
        shot("03-add", delay: 2)

        app.terminate()
        start("light")
        tabAt(2)
        shot("04-delegation", delay: 2)

        app.terminate()
        start("dark")
        tabAt(1)
        shot("05-dark", delay: 2)
        app.terminate()
        start("light")
    }
}
