import Observation
import SwiftUI

enum AddMode { case add, edit, breakdown }

private let FONT_SIZE: CGFloat = 18
private let verticalSpacing: CGFloat = 8
private let hashRegex = "#[\\u0400-\\u04FFa-zA-Z_0-9]+$"

/// One todo form (TodoVM)
@Observable
final class TodoVM: Identifiable {
    let key = Ids.new()
    var id: String { key }

    var text = ""
    var completed = false
    var frog = false
    var monthAndYear: String?
    var date: String?
    var time: String?
    var repetitive = false
    var delegate: DelegationUser?
    var delegateAccepted: Bool?
    var showDatePicker = false
    var showMonthAndYearPicker = false
    var showMore = false
    var addOnTop = false
    var collapsed = false
    var calendarMonth = Date()
    private(set) var editedTodo: Todo?

    /// Bumped to shake the invalid fields
    var shake = 0

    var isValid: Bool { !text.isEmpty && (delegate != nil || monthAndYear != nil) }

    /// YYYY-MM-DD when a day is selected
    var datePickerValue: String? { monthAndYear.flatMap { m in parseTitle((date ?? "").isEmpty ? m : "\(m)-\(date!)")?.dateString } }

    func setDatePickerValue(_ day: Date) {
        monthAndYear = day.monthAndYear
        date = day.day
    }

    init() {
        let step = Onboarding.step
        if Onboarding.active && (step == .AddText || step == .AddTask || Onboarding.savedStep == .AddText) { text = t("onboarding.todoText") }
        if Onboarding.active || Settings.showTodayOnAddTodo == true { setDatePickerValue(todayWithStartOfDay()) }
        if Settings.newTodosGoFirst == true { addOnTop = true }
    }

    func edit(_ todo: Todo) {
        editedTodo = todo
        text = todo.text
        completed = todo.completed
        frog = todo.frog
        monthAndYear = todo.monthAndYear
        date = todo.date
        time = todo.time
        delegateAccepted = todo.delegateAccepted
        repetitive = todo.repetitive
        showMore = true
        datePickerValue.flatMap(parseTitle).map { calendarMonth = $0 }
    }

    /// The cursor isn't readable on iOS 17, so tags go at the end of the text
    func applyTag(_ tag: String) { text = applyTagText(text, text.count, tag).0 }
}

/**
 * TodoVM.applyTag: inserts "#tag" at the cursor, completing a hashtag being typed at the end of the text.
 * Returns the new text and cursor. The RN version left a double space when the cursor was at the end.
 */
func applyTagText(_ text: String, _ cursor: Int, _ tag: String) -> (String, Int) {
    let c = min(max(cursor, 0), text.count)
    var before = String(text.prefix(c))
    let rest = String(text.dropFirst(c))
    let after = rest.isEmpty || rest.hasPrefix(" ") ? rest : " \(rest)"
    let inserted: String
    if text.hasSuffix("#") {
        inserted = tag
    } else {
        if let r = text.range(of: hashRegex, options: .regularExpression) { before = String(before.dropLast(text[r].count)) }
        inserted = !before.isEmpty && !before.hasSuffix(" ") ? " #\(tag)" : "#\(tag)"
    }
    let head = before + inserted
    return after.isEmpty ? (head + " ", head.count + 1) : (head + after, head.count + 1)
}

/**
 * Everything the add screen is editing: its forms, the focused one and the save state. Nav keeps it while the screen
 * is open, so folding or resizing, which moves the screen between a sheet and the side column, keeps the typed text,
 * dates and tags.
 */
@Observable
final class AddTodoDraft: Identifiable {
    let mode: AddMode
    let date: String?
    let text: String?
    let baseTodo: Todo?
    var vms = [TodoVM]()
    var saving = false
    var buttonShake = 0
    var started = false
    /// The form with the keyboard, given back to the screen when it's shown again
    var focused: String?
    /// Set by the shown screen: closes it, asking about unsaved changes first, then runs the given block
    @ObservationIgnored var requestClose: ((@escaping () -> Void) -> Void)?

    init(_ sheet: Sheet) {
        var id: String?
        switch sheet {
        case let .add(date, text): mode = .add; self.date = date; self.text = text
        case let .edit(todoId): mode = .edit; id = todoId; date = nil; text = nil
        case let .breakdown(todoId): mode = .breakdown; id = todoId; date = nil; text = nil
        }
        baseTodo = id.flatMap(Db.shared.todo)
    }
}

struct AddTodoScreen: View {
    let draft: AddTodoDraft
    /// Shown as the column next to the tabs rather than as a sheet
    var inline = false
    @FocusState private var focused: String?

    private var mode: AddMode { draft.mode }
    private var date: String? { draft.date }
    private var text: String? { draft.text }
    private var baseTodo: Todo? { draft.baseTodo }
    private var vms: [TodoVM] {
        get { draft.vms }
        nonmutating set { draft.vms = newValue }
    }
    private var saving: Bool {
        get { draft.saving }
        nonmutating set { draft.saving = newValue }
    }
    private var buttonShake: Int {
        get { draft.buttonShake }
        nonmutating set { draft.buttonShake = newValue }
    }

    private var breakdownTodo: Todo? { mode == .breakdown ? baseTodo : nil }
    private var editedTodo: Todo? { mode == .edit ? baseTodo : nil }
    private var isEdit: Bool { editedTodo != nil }
    private var isValid: Bool { vms.allSatisfy(\.isValid) }

    private func addTodo() {
        vms.forEach { $0.collapsed = true }
        let vm = TodoVM()
        if let breakdownTodo {
            if vms.isEmpty && breakdownTodo.repetitive {
                vm.text = breakdownTodo.text
                vm.time = breakdownTodo.time
            } else if Settings.duplicateTagInBreakdown == true {
                vm.text = hashtags(breakdownTodo.text).map { "#\($0)" }.joined(separator: " ")
            }
            vm.repetitive = breakdownTodo.repetitive
        }
        if let date {
            vm.monthAndYear = String(date.prefix(7))
            vm.date = date.count >= 10 ? String(date.dropFirst(8).prefix(2)) : nil
            parseTitle(date).map { vm.calendarMonth = $0 }
        }
        vms.append(vm)
        let locked = editedTodo?.encrypted == true && Session.encryptionKey == nil
        if !Onboarding.active && !locked {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { focused = vm.key }
        }
    }

    // componentDidMount
    private func start() {
        if draft.started {
            // Shown again after a fold or resize: the keyboard goes back to the form that had it
            if let key = draft.focused { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { focused = key } }
            return
        }
        draft.started = true
        if Onboarding.active && Onboarding.step == .Breakdown {
            for key in ["onboarding.breakdownTodo1", "onboarding.breakdownTodo2", "onboarding.breakdownTodo3"] {
                let vm = TodoVM()
                vm.text = t(key)
                vm.collapsed = true
                vms.append(vm)
            }
        } else { addTodo() }
        if let editedTodo { vms[0].edit(editedTodo) }
        if let text { vms[0].text = text }
        if Onboarding.step == .AddTask || Onboarding.step == .Breakdown { Onboarding.nextStep() }
    }

    private func isDirty() -> Bool {
        for vm in vms {
            if let e = vm.editedTodo {
                if e.text != vm.text || e.completed != vm.completed || e.frog != vm.frog || e.monthAndYear != vm.monthAndYear ||
                    e.date != vm.date || e.time != vm.time || e.repetitive != vm.repetitive { return true }
            } else if !vm.text.isEmpty || vm.addOnTop || vm.completed || vm.frog || vm.monthAndYear != nil || vm.date != nil || vm.time != nil || vm.repetitive {
                if !(!vm.text.isEmpty || vm.completed || vm.frog || vm.time != nil || vm.repetitive) &&
                    vm.monthAndYear != nil && vm.date != nil && isToday(vm.monthAndYear, vm.date) { continue }
                return true
            }
        }
        return false
    }

    private func saveTodo() {
        if saving { return Ui.toast("🤔") }
        if breakdownTodo != nil && Onboarding.active && vms.count < 2 {
            focused = nil
            return Onboarding.nextStep(.BreakdownLessThanTwo)
        }
        saving = true
        let dayCompletedInitially = Todos.shouldShowDayCompletion()
        let initiallyCompleted = editedTodo?.completed == true
        var titles = [String]()
        var onTop = [Todo]()
        var toBottom = [Todo]()
        var completedAtCreation = [String]()
        var toSave = [Todo]()
        let currentMonth = Date().monthAndYear
        let me = Session.user?.id
        for (i, vm) in vms.enumerated() {
            if let edited = vm.editedTodo {
                let oldTitle = edited.title
                let newMonth = vm.monthAndYear ?? currentMonth
                if edited.frogFails > 2 && (edited.monthAndYear != newMonth || edited.date != vm.date) {
                    // The RN app left the screen stuck in "saving" here
                    saving = false
                    return Todos.requestBreakdown(edited) { Nav.closeEditor() }
                }
                let failed = isTodoOld(edited.monthAndYear, edited.date) && (edited.date != vm.date || edited.monthAndYear != vm.monthAndYear) && !edited.completed
                // Fresh copy, and only the fields this form changed: a sync, or the list next to the side column, may
                // have changed the others while it was open
                let todo = Db.shared.todo(edited.id) ?? edited
                if vm.completed && !edited.completed && !todo.completed { completedAtCreation.append(vm.text) }
                if vm.text != edited.text { todo.text = vm.text }
                if vm.completed != edited.completed { todo.completed = vm.completed }
                if vm.frog != edited.frog { todo.frog = vm.frog }
                if vm.monthAndYear != edited.monthAndYear || vm.date != edited.date {
                    todo.monthAndYear = newMonth
                    todo.date = vm.date
                }
                if vm.time != edited.time { todo.time = vm.time }
                if vm.repetitive != edited.repetitive { todo.repetitive = vm.repetitive }
                if failed && !(todo.date ?? "").isEmpty {
                    todo.frogFails += 1
                    if todo.frogFails > 1 { todo.frog = true }
                }
                if vm.delegateAccepted != edited.delegateAccepted { todo.delegateAccepted = vm.delegateAccepted }
                toSave.append(todo)
                titles += [oldTitle, todo.title]
            } else {
                let todo = Todo(text: vm.text, completed: vm.completed, frog: vm.frog, order: Double(i), monthAndYear: vm.monthAndYear ?? currentMonth,
                                date: vm.date, time: vm.time, encrypted: Session.encryptionKey != nil && vm.delegate == nil, repetitive: vm.repetitive)
                if todo.completed { completedAtCreation.append(todo.text) }
                if let delegate = vm.delegate, let me {
                    todo.userId = delegate.id
                    todo.delegatorId = me
                }
                toSave.append(todo)
                titles.append(todo.title)
                if vm.addOnTop { onTop.append(todo) } else { toBottom.append(todo) }
            }
        }
        Db.shared.saveTodos(toSave)
        for text in completedAtCreation {
            Tags.incrementEpicPoints(text)
            Hero.points += 1
        }
        if let breakdownTodo {
            let original = Db.shared.todo(breakdownTodo.id) ?? breakdownTodo
            // The list next to the side column may have completed or deleted it already: no second points or confetti
            if !original.completed && !original.deleted {
                Todos.markCompleted(original)
                Effects.confetti()
            }
            titles.append(original.title)
        }
        let hasCompleted = breakdownTodo != nil || vms.contains { $0.editedTodo?.completed == true || $0.completed }
        let hasFrog = breakdownTodo?.frog == true || vms.contains { $0.editedTodo?.frog == true || $0.frog }
        if hasCompleted && !initiallyCompleted { if hasFrog { Sounds.frogComplete() } else { Sounds.taskComplete() } }
        Nav.closeEditor()
        Tags.addTags(vms.map(\.text))
        Todos.fixOrder(titles, addTodosOnTop: onTop, addTodosToBottom: toBottom, timeTodosToYield: toSave)
        if breakdownTodo != nil && !dayCompletedInitially { Todos.checkDayCompletion() }
        if Onboarding.active { Onboarding.nextStep() }
        focused = nil
    }

    private func trySave() {
        if !isValid || saving {
            for vm in vms where !vm.isValid {
                vm.collapsed = false
                vm.shake += 1
            }
            buttonShake += 1
        } else { saveTodo() }
    }

    private func onBackPress() {
        if Onboarding.active {
            let step = Onboarding.step
            Onboarding.nextStep(step == .BreakdownTodoAction || step == .BreakdownTodo ? .BreakdownLessThanTwo : .Close)
            focused = nil
            return
        }
        askToClose()
    }

    /// Closes the screen, asking first what to do with unsaved changes; [then] runs once it's closed
    private func askToClose(then: @escaping () -> Void = {}) {
        if !isDirty() {
            Nav.closeEditor()
            return then()
        }
        let plural = vms.count > 1
        func s(_ key: String) -> String { t(plural ? key : "\(key)Singular") }
        var buttons = [(String, () -> Void)]()
        if isValid {
            buttons.append((s("saveTasks"), {
                saveTodo()
                // Saving can stop short (a breakdown is needed first): then the screen stays
                if Nav.shared.sheet == nil { then() }
            }))
        }
        buttons.append((s("dissmissTasks"), {
            Nav.closeEditor()
            then()
        }))
        buttons.append((s(isValid ? "changeTasks" : "fixTasks"), {}))
        Ui.shared.dialogs.append(DialogSpec(title: s(isValid ? "dirtyValidSave" : "dirtyInvalidSave"), message: nil, buttons: buttons,
                                            destructive: [isValid ? 1 : 0], sheet: true))
    }

    var body: some View {
        let title = isEdit ? t("editTodo") : mode == .breakdown ? t("breakdownTodo") : t("addTodo")
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if let breakdownTodo {
                        TodoCard(todo: breakdownTodo, type: .breakdown).onboardingTarget(OnboardingTarget.breakdownTodo).plainRow()
                    }
                    ForEach(vms) { vm in
                        let delete: (() -> Void)? = vms.count > 1 ? {
                            vms.removeAll { $0 === vm }
                            if vms.allSatisfy(\.collapsed) { vms.last?.collapsed = false }
                        } : nil
                        VStack(spacing: 0) {
                            if vm.collapsed {
                                CollapsedTodo(vm: vm, delete: delete)
                            } else {
                                TodoForm(vm: vm, delete: delete, showCross: breakdownTodo != nil && Settings.duplicateTagInBreakdown == true, focused: $focused)
                            }
                            if vm !== vms.last { Divider() }
                        }
                        .plainRow()
                        .id(vm.key)
                        .moveDisabled(!vm.collapsed)
                    }
                    // The RN app swapped the two forms instead of moving the dragged one
                    .onMove { vms.move(fromOffsets: $0, toOffset: $1) }
                }
                .appList()
                .scrollDismissesKeyboard(.interactively)
                .readableWidth()
                .onChange(of: vms.count) { _, _ in
                    if let last = vms.last { withAnimation { proxy.scrollTo(last.key, anchor: .top) } }
                }
            }
            .safeAreaInset(edge: .bottom) {
                SaveRow(isEdit: isEdit, plural: vms.count > 1, enabled: isValid && !saving, shake: buttonShake, editedTodo: editedTodo,
                        onSave: trySave, onAdd: addTodo)
                    .background(Colors.background)
            }
            .background(Colors.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    // Only the add screen asks about unsaved changes in RN
                    Button { if mode == .add { onBackPress() } else { Nav.closeEditor() } } label: { Image(systemName: "xmark") }
                        .accessibilityLabel(t("cancel"))
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !isEdit {
                        Button { if mode == .breakdown || !Onboarding.active { addTodo() } } label: { Image(systemName: "plus") }
                            .accessibilityLabel(t("addTodo")).accessibilityIdentifier("addFormTop")
                            .onboardingTarget(OnboardingTarget.addButton)
                    }
                    InfoButton(message: isEdit ? "infoEdit" : mode == .breakdown ? "infoBreakdown" : "infoAdd")
                }
            }
        }
        .interactiveDismissDisabled(Onboarding.active || isDirty())
        .onChange(of: focused) { _, key in
            // Losing the keyboard because this copy of the screen is going away (fold, resize) isn't the user's choice
            if key != nil || Nav.shared.editorInline == inline { draft.focused = key }
        }
        .onAppear {
            start()
            Onboarding.shared.saveTodo = { trySave() }
            draft.requestClose = { askToClose(then: $0) }
        }
        .onDisappear { Onboarding.shared.saveTodo = {} }
        // keyboardDidHide in TodoVM: finishing the text moves the tutorial on
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            if Onboarding.active && !(vms.first?.text.isEmpty ?? true) && (Onboarding.step == .AddText || Onboarding.step == .AddTextContinueButton) {
                Onboarding.nextStep(.SelectDate)
            }
        }
    }
}

private struct SaveRow: View {
    let isEdit: Bool
    let plural: Bool
    let enabled: Bool
    let shake: Int
    let editedTodo: Todo?
    let onSave: () -> Void
    let onAdd: () -> Void

    var body: some View {
        let step = Onboarding.step
        let saveAllowed = !Onboarding.active || step == .AddTodoComplete || step == .BreakdownTodoAction
        let addAllowed = !Onboarding.active || step == .BreakdownTodoAction
        HStack(spacing: 10) {
            Button(action: onSave) {
                Text(t(isEdit ? "saveTodo" : plural ? "addTodoPlural" : "addTodoSingular")).font(.system(size: 16)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(enabled ? Colors.primary : .gray, in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain).disabled(!saveAllowed)
            .accessibilityIdentifier("saveTodos")
            .simultaneousGesture(LongPressGesture().onEnded { _ in
                let json = editedTodo.flatMap { try? JSONSerialization.data(withJSONObject: TodoEntity.toJson($0)) }.flatMap { String(data: $0, encoding: .utf8) }
                Ui.copy(json ?? "undefined", toast: t("copied"))
            })
            .shake(shake)
            .onboardingTarget(OnboardingTarget.saveButton)
            if !isEdit {
                Button(action: onAdd) {
                    TIcon(name: "add_outline_28", size: 20, color: .white).frame(width: 48, height: 48).background(brandGradient, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain).disabled(!addAllowed).accessibilityLabel(t("addTodo")).accessibilityIdentifier("addForm")
            }
        }
        .frame(height: 48)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: 720)
    }
}

private struct CollapseButton: View {
    let vm: TodoVM

    var body: some View {
        Button { vm.collapsed.toggle() } label: {
            Image(systemName: vm.collapsed ? "chevron.down" : "chevron.up").font(.system(size: 18, weight: .medium))
                .foregroundStyle(!vm.collapsed || vm.isValid ? Colors.text : Colors.tomato).frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
    }
}

private struct CollapsedTodo: View {
    let vm: TodoVM
    let delete: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            if let delete { IconBtn(name: "delete_outline_28-iOS", color: Colors.destruct, label: t("delete"), action: delete) }
            VStack(alignment: .leading, spacing: 2) {
                Text((vm.frog ? "🐸 " : "") + (vm.time.map { "\($0) " } ?? "") + (vm.text.isEmpty ? t("todo.create.placeholder") : vm.text))
                    .font(.system(size: FONT_SIZE, weight: .medium)).foregroundStyle(Colors.text).lineLimit(1)
                if let m = vm.monthAndYear {
                    Text("\(m)\((vm.date ?? "").isEmpty ? "" : "-\(vm.date!)")").font(.system(size: 13)).foregroundStyle(Colors.placeholder)
                }
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            CollapseButton(vm: vm)
        }
        .contentShape(Rectangle())
        .onTapGesture { vm.collapsed = false }
        .padding(.vertical, verticalSpacing).padding(.leading, 12).padding(.trailing, 16)
    }
}

/// A tappable form row with a chevron (date, month, time, delegate, more, delete)
private struct FormRow: View {
    let text: String
    let color: Color
    var enabled = true
    var onClear: (() -> Void)? = nil
    var chevronColor: Color = Colors.border
    let action: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: action) {
                HStack {
                    Text(text).font(.system(size: FONT_SIZE)).foregroundStyle(color).frame(maxWidth: .infinity, alignment: .leading)
                    if onClear == nil { TIcon(name: "chevron_right_outline_28", size: 24, color: chevronColor) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(!enabled).accessibilityLabel(text)
            if let onClear {
                Button(action: onClear) { Image(systemName: "xmark").foregroundStyle(Colors.border).frame(width: 24, height: 24) }
                    .buttonStyle(.plain).accessibilityLabel(t("cancel"))
            }
        }
        .padding(.vertical, verticalSpacing)
    }
}

private struct SwitchRow: View {
    let name: String
    let value: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { value }, set: onChange)) { Text(name).font(.system(size: FONT_SIZE)).foregroundStyle(Colors.text) }
            .tint(Colors.primary)
            .padding(.vertical, verticalSpacing)
    }
}

private struct TodoForm: View {
    @Bindable var vm: TodoVM
    let delete: (() -> Void)?
    let showCross: Bool
    var focused: FocusState<String?>.Binding

    var body: some View {
        let tutorial = Onboarding.active
        let step = Onboarding.step
        let me = Session.user?.id
        let pickingAllowed = !tutorial || step == .BreakdownTodoAction || step == .SelectDate
        // The tutorial explains dates first instead of opening a picker
        let dateBlocked = { () -> Bool in
            let blocked = tutorial && step == .SelectDate
            if blocked { Onboarding.nextStep(.SelectDateNotAllowed) }
            return blocked
        }
        let showMoreBlock = (Settings.showMoreByDefault == true && !tutorial) || vm.showMore
        let hasDay = vm.datePickerValue != nil && !(vm.date ?? "").isEmpty
        let monthSet = vm.monthAndYear != nil && (vm.date ?? "").isEmpty
        VStack(alignment: .leading, spacing: 0) {
            TextRow(vm: vm, showCross: showCross, focused: focused)
            TagsRow(vm: vm)
            VStack(spacing: 0) {
                FormRow(text: hasDay ? vm.datePickerValue! : t("addTodoDay"), color: hasDay ? Colors.text : Colors.placeholder, enabled: pickingAllowed) {
                    if dateBlocked() { return }
                    focused.wrappedValue = nil
                    vm.showDatePicker.toggle()
                    if (vm.date ?? "").isEmpty {
                        vm.monthAndYear = nil
                        vm.date = nil
                    }
                    vm.showMonthAndYearPicker = false
                }
                .shake(vm.monthAndYear == nil ? vm.shake : 0)
                .accessibilityIdentifier("dateRow")
                if vm.showDatePicker {
                    let selected = hasDay ? vm.datePickerValue.flatMap(parseTitle) : nil
                    MonthCalendar(month: $vm.calendarMonth, selected: selected, minDate: todayWithStartOfDay()) {
                        vm.setDatePickerValue($0)
                        vm.showDatePicker = false
                    }
                }
                FormRow(text: monthSet ? vm.monthAndYear! : t("addTodoMonth"), color: monthSet ? Colors.text : Colors.placeholder, enabled: pickingAllowed) {
                    if dateBlocked() { return }
                    focused.wrappedValue = nil
                    vm.showMonthAndYearPicker.toggle()
                    if !(vm.date ?? "").isEmpty {
                        vm.monthAndYear = nil
                        vm.date = nil
                    }
                    vm.showDatePicker = false
                    if vm.monthAndYear == nil && vm.showMonthAndYearPicker { vm.monthAndYear = Date().plusMonths(1).monthAndYear }
                }
                .shake(vm.monthAndYear == nil ? vm.shake : 0)
            }
            .onboardingTarget(OnboardingTarget.dateRow)
            if vm.showMonthAndYearPicker {
                MonthYearPicker(selected: vm.monthAndYear) {
                    vm.monthAndYear = $0
                    vm.date = nil
                }
            }
            if showMoreBlock {
                TimeRow(vm: vm)
                if Session.user != nil && vm.editedTodo == nil {
                    let delegates = Db.shared.delegates().filter { $0.id != me }
                    if !delegates.isEmpty {
                        FormRow(text: vm.delegate?.name ?? t("delegate.pickDelegateField"), color: vm.delegate != nil ? Colors.text : Colors.placeholder,
                                onClear: vm.delegate != nil ? { vm.delegate = nil } : nil) {
                            if tutorial { return }
                            Ui.actionSheet(t("delegate.to"), delegates.map { $0.name ?? "" }) { vm.delegate = delegates[$0] }
                        }
                    }
                }
            }
            SwitchRow(name: t("todo.create.frog"), value: vm.frog) {
                vm.frog = $0
                if tutorial && step == .SelectFrog { Onboarding.nextStep() }
            }
            .onboardingTarget(OnboardingTarget.frogRow)
            let delegatedByMe = vm.editedTodo?.delegatorId != nil && vm.editedTodo?.delegatorId == me
            if !delegatedByMe {
                let completedAllowed = !tutorial || step == .BreakdownTodoAction || step == .SelectCompleted
                SwitchRow(name: t("completed"), value: vm.completed) { value in
                    if !completedAllowed { return }
                    if tutorial {
                        Onboarding.nextStep(.BreakdownCompletedTodo)
                        vm.completed = false
                        return
                    }
                    vm.completed = value
                    if Session.user != nil && vm.editedTodo?.delegatorId != me && vm.editedTodo?.delegateAccepted != true {
                        vm.delegateAccepted = value
                    }
                }
                .onboardingTarget(OnboardingTarget.completedRow)
            }
            if Settings.showMoreByDefault == true || vm.showMore {
                SwitchRow(name: t("breakdownMessage.title"), value: vm.repetitive) { vm.repetitive = $0 }
            }
            if showMoreBlock && vm.editedTodo == nil {
                SwitchRow(name: t("addTodoOnTop"), value: vm.addOnTop) { vm.addOnTop = $0 }
            }
            if (Settings.showMoreByDefault != true || tutorial) && !vm.showMore {
                FormRow(text: t("addTodoMore"), color: Colors.primary, enabled: !tutorial || step == .ShowMore || step == .BreakdownTodoAction, chevronColor: Colors.primary) {
                    vm.showMore = true
                    if tutorial && step == .ShowMore { Onboarding.nextStep() }
                }
                .onboardingTarget(OnboardingTarget.showMoreRow)
            }
            if let delete {
                FormRow(text: t("delete"), color: Colors.primary, chevronColor: Colors.primary, action: delete)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, verticalSpacing)
    }
}

/// Time: tapping the empty row sets the current time (and today when there's no date), then a time picker edits it
private struct TimeRow: View {
    @Bindable var vm: TodoVM

    var body: some View {
        if let time = vm.time, let (h, m) = parseTime(time) {
            HStack {
                Text(t("addTodoTime")).font(.system(size: FONT_SIZE)).foregroundStyle(Colors.text)
                Spacer()
                DatePicker("", selection: Binding(get: { calendar.date(bySettingHour: h, minute: m, second: 0, of: Date())! }, set: { d in
                    let c = calendar.dateComponents([.hour, .minute], from: d)
                    vm.time = hhmm(c.hour!, c.minute!)
                }), displayedComponents: .hourAndMinute).labelsHidden()
                Button { vm.time = nil } label: { Image(systemName: "xmark").foregroundStyle(Colors.border).frame(width: 24, height: 24) }
                    .buttonStyle(.plain).accessibilityLabel(t("cancel"))
            }
            .padding(.vertical, verticalSpacing / 2)
        } else {
            FormRow(text: t("addTodoTime"), color: Colors.placeholder) {
                let c = calendar.dateComponents([.hour, .minute], from: Date())
                vm.time = hhmm(c.hour!, c.minute!)
                if vm.monthAndYear == nil { vm.setDatePickerValue(Date()) }
            }
        }
    }
}

private struct TextRow: View {
    @Bindable var vm: TodoVM
    let showCross: Bool
    var focused: FocusState<String?>.Binding

    var body: some View {
        let tutorial = Onboarding.active
        let locked = vm.editedTodo?.encrypted == true && Session.encryptionKey == nil
        HStack(spacing: 0) {
            TextField(t("todo.create.text"), text: $vm.text, axis: tutorial ? .horizontal : .vertical)
                .font(.system(size: FONT_SIZE)).foregroundStyle(Colors.text)
                .focused(focused, equals: vm.key)
                .disabled(locked)
                .submitLabel(tutorial ? .done : .return)
                .onSubmit {
                    if tutorial && !vm.text.isEmpty && (Onboarding.step == .AddText || Onboarding.step == .AddTextContinueButton) { Onboarding.nextStep(.SelectDate) }
                }
                .onChange(of: vm.text) { _, text in
                    // maxLength={1500}: cut, don't reject (a long paste still goes in)
                    if text.count > 1500 { vm.text = String(text.prefix(1500)) }
                    if tutorial { Onboarding.shared.textInTodo = text }
                }
                .accessibilityIdentifier("todoText")
            if !vm.text.isEmpty && showCross {
                Button { vm.text = "" } label: { Image(systemName: "xmark").frame(width: 30, height: 30) }.buttonStyle(.plain).foregroundStyle(Colors.text)
            }
            if !locked && vm.text.isEmpty {
                PasteButton(payloadType: String.self) { strings in
                    DispatchQueue.main.async { vm.text += strings.first ?? "" }
                }
                .labelStyle(.iconOnly).buttonBorderShape(.circle).tint(Colors.text.opacity(0.15)).foregroundStyle(Colors.text)
            }
            CollapseButton(vm: vm)
        }
        .shake(vm.text.isEmpty ? vm.shake : 0)
        .padding(.vertical, verticalSpacing)
        .onboardingTarget(OnboardingTarget.textRow)
    }
}

private struct TagsRow: View {
    let vm: TodoVM

    var body: some View {
        let tags = Tags.suggestions(vm.text, showMore: vm.showMore)
        if !tags.isEmpty {
            FlowLayout {
                ForEach(tags, id: \.id) { tag in
                    Button { vm.applyTag(tag.tag) } label: {
                        Text("#\(tag.tag)").foregroundStyle(tag.color.flatMap { $0.isEmpty ? nil : hex($0) } ?? Colors.link)
                            .padding(.horizontal, 4).padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, verticalSpacing / 2)
        }
    }
}
