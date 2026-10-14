import AuthenticationServices
import SwiftUI
import VisionKit

/// Scans a QR code with the camera (VisionKit's scanner) and hands over its text
private struct QRScannerSheet: View {
    let onResult: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    Scanner { code in
                        dismiss()
                        onResult(code)
                    }
                    .ignoresSafeArea()
                } else {
                    Text(t("cameraAuthorization")).multilineTextAlignment(.center).padding()
                }
            }
            .navigationTitle(t("qrDescription"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(t("cancel")) { dismiss() } } }
        }
    }

    private struct Scanner: UIViewControllerRepresentable {
        let onCode: (String) -> Void

        func makeUIViewController(context: Context) -> DataScannerViewController {
            let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
            scanner.delegate = context.coordinator
            try? scanner.startScanning()
            return scanner
        }

        func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}
        func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

        final class Coordinator: NSObject, DataScannerViewControllerDelegate {
            let onCode: (String) -> Void
            private var done = false
            init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

            func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
                for case let .barcode(code) in items {
                    guard !done, let value = code.payloadStringValue, !value.isEmpty else { continue }
                    done = true
                    scanner.stopScanning()
                    onCode(value)
                }
            }
        }
    }
}

extension View {
    func qrScanner(isPresented: Binding<Bool>, onResult: @escaping (String) -> Void) -> some View {
        sheet(isPresented: isPresented) { QRScannerSheet(onResult: onResult) }
    }
}

@Observable
private final class LoginState {
    var loading = false
    var syncLoading = false

    /// Gets the user from [request], logs in and leaves the login screen
    func login(_ errorText: String? = nil, _ request: @escaping () async throws -> User) {
        loading = true
        Task { @MainActor in
            do {
                let user = try await request()
                syncLoading = true
                try await Account.login(user)
                Nav.back()
            } catch {
                if let errorText { Ui.error(errorText) } else { Ui.error(error) }
            }
            syncLoading = false
            loading = false
        }
    }
}

struct LoginScreen: View {
    @State private var state = LoginState()
    @State private var debugToken = ""
    @State private var scanning = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Self-hosted servers may have no OAuth apps: email + password comes first there
        let custom = Rest.server != nil
        ScrollView {
            VStack(spacing: 10) {
                if state.loading { ProgressView().padding(6) }
                if custom { PasswordLogin(state: state) }
                SignInWithAppleButton(.signIn) { $0.requestedScopes = [.fullName, .email] } onCompletion: { result in
                    switch result {
                    case let .success(auth):
                        guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                              let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) else { return Ui.error(t("appleSigninError")) }
                        state.login(t("appleSigninError")) { try await Rest.loginApple(code: code, name: credential.fullName, email: credential.email) }
                    case let .failure(error):
                        if (error as? ASAuthorizationError)?.code != .canceled { Ui.error(t("appleSigninError")) }
                    }
                }
                .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                .frame(height: 50).clipShape(RoundedRectangle(cornerRadius: 10))
                .disabled(state.loading)
                // The Telegram page signs in on todorant.com only
                if !custom {
                    PrimaryButton(text: t("loginTelegram"), color: Color(UIColor(rgb: 0x1E90FF)), enabled: !state.loading) { Nav.push(.telegram) }
                }
                PrimaryButton(text: t("loginQR"), color: Color(UIColor(rgb: 0x483D8B)), enabled: !state.loading) { scanning = true }
                if !custom { PasswordLogin(state: state) }
                #if DEBUG
                TextField("Enter token here", text: $debugToken).textFieldStyle(.roundedBorder).autocorrectionDisabled().textInputAutocapitalization(.never)
                PrimaryButton(text: "Login with token", color: Color(UIColor(rgb: 0x483D8B)), enabled: !state.loading) {
                    state.login { try await Rest.loginToken(debugToken.trimmingCharacters(in: .whitespacesAndNewlines)) }
                }
                #endif
                ServerSetting(link: true).padding(8)
            }
            .padding(16)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Colors.background)
        .navigationTitle(t("pleaseLogin"))
        .navigationBarTitleDisplayMode(.inline)
        .qrScanner(isPresented: $scanning) { token in state.login { try await Rest.loginToken(token) } }
        .overlay {
            if state.syncLoading {
                VStack(spacing: 12) {
                    ProgressView().tint(.white).controlSize(.large)
                    Text(t("loadingData")).foregroundStyle(.white).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.7))
                .ignoresSafeArea()
            }
        }
    }
}

/// Email + password: sign in, or create the account
private struct PasswordLogin: View {
    let state: LoginState
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 10) {
            TextField(t("email"), text: $email).keyboardType(.emailAddress).textContentType(.username)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(12).background(Colors.cardBackground, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Colors.border.opacity(0.5)))
                .accessibilityIdentifier("email")
            SecureField(t("password"), text: $password).textContentType(.password)
                .padding(12).background(Colors.cardBackground, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Colors.border.opacity(0.5)))
                .accessibilityIdentifier("password")
            HStack(spacing: 10) {
                ForEach([("signIn", false), ("signUp", true)], id: \.0) { title, signup in
                    PrimaryButton(text: t(title), enabled: !state.loading && !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty) {
                        if password.count < 8 { Ui.error(t("passwordLength")) } else { state.login { try await Rest.loginPassword(email, password, signup: signup) } }
                    }
                }
            }
        }
    }
}

struct TelegramLoginScreen: View {
    @State private var handled = false

    var body: some View {
        WebPageScreen(title: t("loginTelegram"), url: "https://todorant.com/mobile-login/telegram") { url in
            let text = url.absoluteString
            guard !handled, text.contains("mobile_login_success") else { return true }
            handled = true
            // decodeURI of everything after "data=": query parsing would turn '+' into spaces and stop at '&'
            guard let range = text.range(of: "mobile_login_success?data="),
                  let data = String(text[range.upperBound...]).removingPercentEncoding, let user = User(text: data) else {
                Nav.back()
                Ui.error(t("error"))
                return false
            }
            // Leave Telegram and the login screen; data loads in the background
            Nav.back()
            Nav.back()
            Ui.attempt { try await Account.login(user) }
            return false
        }
    }
}
