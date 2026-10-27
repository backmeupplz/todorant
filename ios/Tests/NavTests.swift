import XCTest
@testable import Todorant

/// The add screen's draft lives in Nav, so a fold or resize that rebuilds the screen keeps it (#214)
final class NavTests: XCTestCase {
    override func setUp() {
        Db.shared.open(":memory:")
        Nav.shared.sheet = nil
        Nav.shared.editorInline = false
    }

    override func tearDown() {
        Nav.shared.sheet = nil
        Nav.shared.editorInline = false
    }

    func testDraftFollowsTheSheet() {
        let nav = Nav.shared
        XCTAssertNil(nav.draft)
        nav.sheet = .add(date: "2026-10-27")
        let draft = try! XCTUnwrap(nav.draft)
        XCTAssertEqual(draft.mode, .add)
        XCTAssertEqual(draft.date, "2026-10-27")
        draft.vms.append(TodoVM())
        draft.vms[0].text = "Half typed #tag"
        draft.focused = draft.vms[0].key
        // The screen moving between the sheet and the column doesn't touch the sheet, so the draft stays
        nav.editorInline = true
        nav.sheet = .add(date: "2026-10-27")
        XCTAssertTrue(nav.draft === draft)
        nav.editorInline = false
        XCTAssertEqual(nav.draft?.vms.first?.text, "Half typed #tag")
        XCTAssertEqual(nav.draft?.focused, draft.vms[0].key)
        // Closing ends it, and lets go of the screen's close block; opening again starts over
        draft.requestClose = { _ in }
        Nav.closeEditor()
        XCTAssertNil(nav.draft)
        XCTAssertNil(draft.requestClose)
        nav.sheet = .add(date: "2026-10-27")
        XCTAssertFalse(nav.draft === draft)
        XCTAssertTrue(nav.draft?.vms.isEmpty == true)
    }

    /// Side by side the tabs stay usable: their navigation leaves the column alone, and another todo asks the open one first
    func testInlineEditorNextToTheTabs() {
        let nav = Nav.shared
        nav.editorInline = true
        nav.tab = .settings
        Nav.push(.tags)
        nav.sheet = .add()
        let draft = try! XCTUnwrap(nav.draft)
        Nav.back()
        XCTAssertEqual(nav.paths[.settings], [])
        XCTAssertTrue(nav.draft === draft)
        Nav.go(.planning)
        XCTAssertEqual(nav.tab, .planning)
        XCTAssertTrue(nav.draft === draft)
        Nav.go(.add())
        XCTAssertTrue(nav.draft === draft)
        var asked = false
        draft.requestClose = { then in
            asked = true
            Nav.closeEditor()
            then()
        }
        Nav.go(.edit("x"))
        XCTAssertTrue(asked)
        XCTAssertEqual(nav.sheet, .edit("x"))
        XCTAssertFalse(nav.draft === draft)
        // A change the user keeps (Change task): nothing is replaced
        nav.draft?.requestClose = { _ in }
        Nav.go(.breakdown("y"))
        XCTAssertEqual(nav.sheet, .edit("x"))
        // In a sheet, tabs close it as before
        nav.editorInline = false
        Nav.go(.current)
        XCTAssertNil(nav.sheet)
    }

    func testEditDraftLoadsTheTodo() {
        let todo = Todo(text: "Edit me", monthAndYear: "2026-10", date: "27")
        Db.shared.saveTodos([todo])
        Nav.shared.sheet = .edit(todo.id)
        XCTAssertEqual(Nav.shared.draft?.mode, .edit)
        XCTAssertEqual(Nav.shared.draft?.baseTodo?.text, "Edit me")
        Nav.go(.planning)
        XCTAssertNil(Nav.shared.draft)
    }
}
