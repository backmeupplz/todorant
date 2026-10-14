import XCTest

/// Walks the first steps of the tutorial on a fresh install (logged out)
final class Tutorial: TodorantUITest {
    func testTutorial() {
        launch(skipTutorial: false)
        tap(button("Sure! Show me how it works"))
        shot("60-explain")
        tap(button("Continue"))
        shot("61-add-task")
        tap(app.buttons["plus"])
        sleep(2)
        shot("62-add-text")
        // Text is prefilled by the tutorial; the date step explains instead of opening a picker
        let next = button("Continue")
        if next.waitForExistence(timeout: 5) { next.tap() }
        shot("63-select-date")
        tap(button("Continue"))
        shot("64-frog")
        tap(button("It's not a frog"))
        shot("65-completed")
        tap(button("Continue"))
        shot("66-show-more")
        tap(button("More..."))
        shot("67-add-another")
        tap(button("Continue"))
        shot("68-save")
        tap(button("Got it!"))
        sleep(2)
        shot("69-explain-current")
    }
}
