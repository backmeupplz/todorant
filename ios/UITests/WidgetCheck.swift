import XCTest

/// Adds the widget to the home screen and uses its buttons (springboard UI; run on a clean simulator)
final class WidgetCheck: TodorantUITest {
    func testWidget() {
        launch(token: env["TOKEN"])
        wait(containing("Widget todo one"), timeout: 30)
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        sleep(2)
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).press(forDuration: 2)
        shot("40-edit-home")
        let add = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Edit' OR label CONTAINS[c] 'Add Widget'")).firstMatch
        if add.waitForExistence(timeout: 5) { add.tap() }
        sleep(1)
        let addWidget = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Add Widget'")).firstMatch
        if addWidget.waitForExistence(timeout: 5) { addWidget.tap() }
        sleep(2)
        shot("41-gallery")
        let search = springboard.searchFields.firstMatch
        if search.waitForExistence(timeout: 5) {
            search.tap()
            search.typeText("Todorant")
        }
        sleep(2)
        shot("42-search")
        let matches = springboard.descendants(matching: .any).matching(NSPredicate(format: "label == 'Todorant'"))
        for i in 0..<matches.count where matches.element(boundBy: i).elementType != .icon && matches.element(boundBy: i).isHittable {
            matches.element(boundBy: i).tap()
            break
        }
        sleep(2)
        shot("43-preview")
        let addButton = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Add Widget'")).firstMatch
        if addButton.waitForExistence(timeout: 5) { addButton.tap() }
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(3)
        shot("44-home")
        // The widget's done button completes the current todo in the shared database
        let done = springboard.buttons.matching(NSPredicate(format: "label == 'Completed'")).firstMatch
        if done.waitForExistence(timeout: 5) {
            done.tap()
            sleep(3)
            shot("45-after-done")
        } else { print(springboard.debugDescription) }
        app.activate()
        wait(containing("Widget todo two"), timeout: 10)
        shot("46-app-after-widget")
    }
}
