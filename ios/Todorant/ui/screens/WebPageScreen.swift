import SwiftUI
import WebKit

/**
 * A pushed screen with a web view (terms, privacy, Telegram and Google logins).
 * [onNavigate] sees every navigation and returns false to stop it.
 */
struct WebPageScreen: View {
    let title: String
    let url: String
    var userAgent: String? = nil
    var onNavigate: (URL) -> Bool = { _ in true }
    @State private var loading = true

    var body: some View {
        WebView(url: url, userAgent: userAgent, onNavigate: onNavigate, loading: $loading)
            .overlay { if loading { ProgressView() } }
            .background(Colors.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct WebView: UIViewRepresentable {
    let url: String
    let userAgent: String?
    let onNavigate: (URL) -> Bool
    @Binding var loading: Bool

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.navigationDelegate = context.coordinator
        view.customUserAgent = userAgent
        view.isOpaque = false
        view.backgroundColor = .clear
        URL(string: url).map { view.load(URLRequest(url: $0)) }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebView
        init(_ parent: WebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .allow }
            return parent.onNavigate(url) ? .allow : .cancel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
    }
}
