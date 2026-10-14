import Foundation

/**
 * Same JSON translations and keys as the RN and Android apps (i18n-js with `%{var}` interpolation, falls back
 * to English). The project references android/app/src/main/assets/translations directly (a folder reference
 * copied into the bundle as "translations"), so all apps share one set of files.
 */
enum I18n {
    static let languages = ["en", "ru", "uk", "it", "es", "pt-br"]
    static let strings: [String: [String: String]] = {
        var all = [String: [String: String]]()
        for lang in languages {
            guard let url = Bundle.main.url(forResource: lang, withExtension: "json", subdirectory: "translations"),
                  let json = (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? [String: Any] else { continue }
            var out = [String: String]()
            flatten("", json, &out)
            all[lang] = out
        }
        return all
    }()

    private static func flatten(_ prefix: String, _ value: Any, _ out: inout [String: String]) {
        switch value {
        case let obj as [String: Any]: for (k, v) in obj { flatten(prefix.isEmpty ? k : "\(prefix).\(k)", v, &out) }
        // i18n-js reads "rules.0" from arrays
        case let arr as [Any]: for (i, v) in arr.enumerated() { flatten("\(prefix).\(i)", v, &out) }
        default: out[prefix] = "\(value)"
        }
    }

    static func start() { Settings.language = languageTag() }

    /// getLanguageTag(): the user's pick, or the best match for the system language
    static func languageTag() -> String {
        if let pick = Settings.languageSelect, pick != "auto" { return pick }
        for id in Locale.preferredLanguages {
            let tag = id.lowercased()
            let language = String(tag.split(separator: "-").first ?? "")
            if languages.contains(tag) { return tag }
            if languages.contains(language) { return language }
            if language == "pt" { return "pt-br" }
        }
        return "en"
    }

    static func has(_ key: String) -> Bool { strings[Settings.language ?? "en"]?[key] != nil || strings["en"]?[key] != nil }

    static var locale: Locale { Locale(identifier: Settings.language ?? "en") }
}

/// translate() from the RN app. Reads Settings.language, so views re-render on a language change.
func t(_ key: String, _ args: (String, Any)...) -> String {
    let lang = Settings.language ?? "en"
    var s = I18n.strings[lang]?[key] ?? I18n.strings["en"]?[key] ?? key
    for (name, value) in args { s = s.replacingOccurrences(of: "%{\(name)}", with: "\(value)") }
    return s
}
