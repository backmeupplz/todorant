import CommonCrypto
import CryptoKit
import Foundation

extension String {
    func ellipsize(_ max: Int) -> String { count > max ? "\(prefix(max))..." : self }
}

// region Time (time.ts)

/// Days are local calendar dates; formatting is fixed so titles look the same on every device
let calendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = .current
    return c
}()

private let dayFormat: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.calendar = calendar
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

extension Date {
    var dateString: String { dayFormat.string(from: self) }
    var monthAndYear: String { String(dateString.prefix(7)) }
    var day: String { String(dateString.suffix(2)) }
    func plusDays(_ n: Int) -> Date { calendar.date(byAdding: .day, value: n, to: self)! }
    func plusMonths(_ n: Int) -> Date { calendar.date(byAdding: .month, value: n, to: self)! }
    var startOfDay: Date { calendar.startOfDay(for: self) }
}

/// Today, shifted back a day while it's earlier than the "start time of day" setting
func todayWithStartOfDay(_ now: Date = Date(), _ startTimeOfDay: String = Settings.startTimeOfDaySafe) -> Date {
    let start = parseTime(startTimeOfDay) ?? (0, 0)
    let c = calendar.dateComponents([.hour, .minute], from: now)
    return (c.hour!, c.minute!) < start ? now.plusDays(-1).startOfDay : now.startOfDay
}

func todayTitle() -> String { todayWithStartOfDay().dateString }

/// "HH:mm" → (hour, minute)
func parseTime(_ time: String?) -> (Int, Int)? {
    guard let time, time.count >= 5, let h = Int(time.prefix(2)), let m = Int(time.dropFirst(3).prefix(2)), (0..<24).contains(h), (0..<60).contains(m) else { return nil }
    return (h, m)
}

func hhmm(_ hour: Int, _ minute: Int) -> String { String(format: "%02d:%02d", hour, minute) }

/// "YYYY-MM" or "YYYY-MM-DD" to a local date (first of month for the former)
func parseTitle(_ title: String) -> Date? {
    let day = title.count == 7 ? "\(title)-01" : String(title.prefix(10))
    guard let date = dayFormat.date(from: day), date.dateString == day else { return nil }
    return date
}

/// `new Date(getTitle(todo)).getTime()` — JS parses ISO dates as UTC midnight
func exactDate(_ title: String) -> Int? {
    guard let date = parseTitle(title) else { return nil }
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return Int(utc.date(from: c)!.timeIntervalSince1970) * 1000
}

/**
 * isTodoOld() from the RN app. The RN version compared day numbers as "day - 1",
 * which broke on the first day of a month; this compares real dates instead.
 */
func isTodoOld(_ monthAndYear: String?, _ date: String?, _ now: Date = Date(), _ startTimeOfDay: String = Settings.startTimeOfDaySafe) -> Bool {
    let currentMonth = now.monthAndYear
    if let date, !date.isEmpty {
        guard let day = parseTitle("\(monthAndYear ?? "")-\(date)") else { return false }
        return day < todayWithStartOfDay(now, startTimeOfDay)
    }
    guard let monthAndYear else { return false }
    return monthAndYear <= currentMonth
}

func isToday(_ monthAndYear: String?, _ date: String?) -> Bool { "\(monthAndYear ?? "")-\(date ?? "")" == Date().dateString }

// endregion

// region Encryption (crypto-js AES compatible: "Salted__" + EVP_BytesToKey(MD5))

enum Crypto {
    static func encrypt(_ plain: String, _ password: String) -> String {
        let salt = Data((0..<8).map { _ in UInt8.random(in: 0...255) })
        let (key, iv) = evpKdf(Data(password.utf8), salt)
        let body = aes(CCOperation(kCCEncrypt), Data(plain.utf8), key, iv)!
        return (Data("Salted__".utf8) + salt + body).base64EncodedString()
    }

    /// Returns nil when the password is wrong or the text isn't encrypted (crypto-js returns "")
    static func decrypt(_ encrypted: String, _ password: String) -> String? {
        guard let bytes = Data(base64Encoded: encrypted.trimmingCharacters(in: .whitespacesAndNewlines)),
              bytes.count >= 16, bytes.prefix(8) == Data("Salted__".utf8) else { return nil }
        let (key, iv) = evpKdf(Data(password.utf8), bytes.subdata(in: 8..<16))
        guard let plain = aes(CCOperation(kCCDecrypt), bytes.subdata(in: 16..<bytes.count), key, iv),
              let text = String(data: plain, encoding: .utf8), !text.isEmpty else { return nil }
        return text
    }

    private static func aes(_ op: CCOperation, _ input: Data, _ key: Data, _ iv: Data) -> Data? {
        var out = Data(count: input.count + kCCBlockSizeAES128)
        var moved = 0
        let status = out.withUnsafeMutableBytes { o in
            input.withUnsafeBytes { i in
                key.withUnsafeBytes { k in
                    iv.withUnsafeBytes { v in
                        CCCrypt(op, CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding), k.baseAddress, key.count,
                                v.baseAddress, i.baseAddress, input.count, o.baseAddress, o.count, &moved)
                    }
                }
            }
        }
        return status == kCCSuccess ? out.prefix(moved) : nil
    }

    private static func evpKdf(_ password: Data, _ salt: Data) -> (Data, Data) {
        var derived = Data()
        var block = Data()
        while derived.count < 48 {
            block = Data(Insecure.MD5.hash(data: block + password + salt))
            derived += block
        }
        return (derived.prefix(32), derived.subdata(in: 32..<48))
    }
}

// endregion

// region Linkify (linkify.ts)

enum TextPart: Equatable {
    case plain(String)
    case link(url: String, value: String)
    /// value includes the leading '#'
    case hash(String)

    var value: String {
        switch self {
        case let .plain(v), let .hash(v): return v
        case let .link(_, v): return v
        }
    }
}

private let HASH_CHARS = "\\u0400-\\u04FFa-zA-Z_0-9"
private let TLDS = "com|org|net|io|ru|ua|me|co|dev|app|info|biz|edu|gov|uk|de|fr|it|es|br|pt|us|ca|au|in|jp|cn|tv|xyz|ai|ly|gg|so|to|fm|am|by|kz|su|рф|onion|link|site|online|store|blog|news|page|ws|cc|eu|nl|pl|ch|se|no|fi|cz|il|tr"
private let linkRegex = try! NSRegularExpression(
    pattern: "(?<![\\w@/#])(?:(?:https?|ftp|file)://[^\\s<>\"]+|www\\.[^\\s<>\"]+|(?:[\\p{L}\\d-]+\\.)+(?:\(TLDS))(?![\\p{L}\\d-])(?:[/?#][^\\s<>\"]*)?)" +
        "|(?<=^|[\\s\\p{P}&&[^#_]])#[\(HASH_CHARS)]+",
    options: .caseInsensitive
)
private let trailingPunctuation = try! NSRegularExpression(pattern: "[.,;:!?)\\]}'\"]+$")

/// Splits text into plain text, links and #hashtags
func linkify(_ text: String) -> [TextPart] {
    let ns = text as NSString
    var parts = [TextPart]()
    var end = 0
    for m in linkRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        var raw = ns.substring(with: m.range)
        if !raw.hasPrefix("#") {
            raw = trailingPunctuation.stringByReplacingMatches(in: raw, range: NSRange(location: 0, length: (raw as NSString).length), withTemplate: "")
        }
        if raw.isEmpty { continue }
        if m.range.location > end { parts.append(.plain(ns.substring(with: NSRange(location: end, length: m.range.location - end)))) }
        parts.append(raw.hasPrefix("#") ? .hash(raw) : .link(url: normalizeUrl(raw), value: displayUrl(raw)))
        end = m.range.location + (raw as NSString).length
    }
    if end < ns.length || parts.isEmpty { parts.append(.plain(ns.substring(from: end))) }
    return parts
}

private func normalizeUrl(_ raw: String) -> String { raw.range(of: "^[a-z]+://", options: [.regularExpression, .caseInsensitive]) != nil ? raw : "http://\(raw)" }

/// "host/..." when there's a path, like the RN app shows links
private func displayUrl(_ raw: String) -> String {
    guard let url = URLComponents(string: normalizeUrl(raw)), let host = url.host else { return raw }
    let hasMore = !url.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty || url.fragment != nil || url.query != nil
    return hasMore ? "\(host)/..." : host
}

/// Hashtags in a text, without '#'
func hashtags(_ text: String) -> [String] {
    linkify(text).compactMap { if case let .hash(v) = $0 { return String(v.dropFirst()) } else { return nil } }
}

/// Q.sanitizeLikeString used for search
func sanitizeLike(_ value: String) -> String { value.replacingOccurrences(of: "[^а-яА-Яa-zA-Z0-9]", with: "_", options: .regularExpression) }

private let sentenceStart = try! NSRegularExpression(pattern: "(:?\\.\\s?|^)([A-Za-z\\u00C0-\\u1FFF\\u2800-\\uFFFD])")

func capitalizeSentence(_ input: String) -> String {
    let ns = NSMutableString(string: input)
    for m in sentenceStart.matches(in: input, range: NSRange(location: 0, length: ns.length)).reversed() {
        ns.replaceCharacters(in: m.range, with: ns.substring(with: m.range).uppercased())
    }
    return ns as String
}

// endregion
