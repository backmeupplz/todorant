import Social
import UniformTypeIdentifiers

/**
 * "Share to Todorant": the shared text or link becomes a todo for today in the shared database, which the app
 * pushes when it next syncs (Android opens the add screen instead; extensions can't open their app).
 */
final class ShareViewController: SLComposeServiceViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Db.shared.open()
        title = "Todorant"
        placeholder = t("todo.create.text")
        navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = t("addTodoSingular")
        // A shared link comes as a URL, not text: add it after the page title
        for item in extensionContext?.inputItems as? [NSExtensionItem] ?? [] {
            for provider in item.attachments ?? [] where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { url, _ in
                    guard let url = url as? URL, !url.isFileURL else { return }
                    DispatchQueue.main.async {
                        if !self.contentText.contains(url.absoluteString) {
                            self.textView.text = [self.contentText, url.absoluteString].filter { !$0.isEmpty }.joined(separator: " ")
                            self.validateContent()
                        }
                    }
                }
            }
        }
    }

    override func isContentValid() -> Bool {
        !contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Session.user != nil
    }

    override func didSelectPost() {
        let today = todayWithStartOfDay()
        let text = String(contentText.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1500))
        let todo = Todo(text: text, monthAndYear: today.monthAndYear, date: today.day, encrypted: Session.encryptionKey != nil)
        Db.shared.saveTodos([todo])
        let newFirst = Settings.newTodosGoFirst == true
        Todos.fixOrder([todo.title], addTodosOnTop: newFirst ? [todo] : [], addTodosToBottom: newFirst ? [] : [todo])
        Tags.addTags([text])
        extensionContext?.completeRequest(returningItems: [])
    }

    override func configurationItems() -> [Any]! { [] }
}
