import XCTest

/// Shares a page from Safari to Todorant; the todo shows up in the app
final class ShareCheck: TodorantUITest {
    func testShare() {
        launch(token: env["TOKEN"])
        wait(text("To infinity!"), timeout: 30)
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        safari.open(URL(string: "https://example.com")!)
        sleep(4)
        let share = safari.buttons["Share"].firstMatch
        if !share.waitForExistence(timeout: 5) { safari.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'More'")).firstMatch.tap() }
        tap(safari.buttons["Share"].firstMatch)
        sleep(2)
        shot("70-share-sheet")
        let todorant = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Todorant'")).firstMatch
        if !todorant.waitForExistence(timeout: 5) { print(safari.debugDescription) }
        todorant.tap()
        sleep(2)
        shot("71-share-compose")
        tap(safari.buttons["Add todo!"].firstMatch)
        sleep(1)
        app.activate()
        tap(app.tabBars.buttons["Planning"])
        wait(containing("example.com"), timeout: 10)
        shot("72-shared-todo")
    }
}
