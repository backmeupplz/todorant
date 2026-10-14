import SwiftUI
import UIKit

extension UIColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: alpha)
    }
}

/// A color for light and dark appearance, resolved by the trait collection (the root applies the color mode setting)
private func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
}

private let namedColors: [String: UInt32] = [
    "dodgerblue": 0x1E90FF, "tomato": 0xFF6347, "grey": 0x808080, "gray": 0x808080,
    "darkslateblue": 0x483D8B, "green": 0x008000, "white": 0xFFFFFF, "black": 0x000000,
]

/// CSS-ish colors as tags store them: #rgb, #rrggbb, #rrggbbaa or a few names
func hex(_ value: String) -> Color {
    var s = value.hasPrefix("#") ? String(value.dropFirst()) : value
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    if (s.count == 6 || s.count == 8), let n = UInt32(s, radix: 16) {
        return s.count == 6 ? Color(UIColor(rgb: n)) : Color(UIColor(rgb: n >> 8, alpha: CGFloat(n & 0xFF) / 255))
    }
    return Color(UIColor(rgb: namedColors[value.lowercased()] ?? 0x1E90FF))
}

extension Color {
    /// "#RRGGBB"
    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        func c(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", c(r), c(g), c(b))
    }
}

/// sharedColors from the RN app
enum Colors {
    static let text = dynamic(UIColor(rgb: 0x060606), UIColor(rgb: 0xF9F9F9))
    static let invertedText = dynamic(UIColor(rgb: 0xF9F9F9), UIColor(rgb: 0x060606))
    static let primary = dynamic(UIColor(rgb: 0xEB6A52), UIColor(rgb: 0xFF641A))
    static let background = dynamic(UIColor(rgb: 0xFCFCFE), UIColor(rgb: 0x19191A))
    static let cardBackground = dynamic(.white, UIColor(rgb: 0x1F1F1F))
    static let border = dynamic(UIColor(rgb: 0x000000, alpha: 0.3), UIColor(rgb: 0xF3F3F6, alpha: 0.3))
    static let divider = dynamic(UIColor(rgb: 0xD7D8D9), UIColor(rgb: 0xEAEDF1, alpha: 0.2))
    static let defaultIcon = Color(UIColor(rgb: 0x3366FF))
    static let destruct = Color(UIColor(rgb: 0xE64646))
    static let success = Color(UIColor(rgb: 0x4BB34B))
    static let placeholder = Color(UIColor(rgb: 0x808080))
    static let oldTodoBackground = dynamic(UIColor(rgb: 0xFFF0F5), UIColor(rgb: 0x800000))
    static let progressBarBackground = dynamic(UIColor(rgb: 0x060606, alpha: 0.2), UIColor(rgb: 0xF9F9F9, alpha: 0.2))
    static let link = Color(UIColor(rgb: 0x1E90FF))
    static let tomato = Color(UIColor(rgb: 0xFF6347))
    static let segmentBackground = dynamic(UIColor(rgb: 0xEEEEF0), UIColor(rgb: 0x2F2F33))
    static let segmentTint = dynamic(UIColor(rgb: 0x6E7185), UIColor(rgb: 0x68686D))

    /// color-scheme's mono/soft schemes for hues 0..345 step 15, used for hero ranks
    static let colorSchemes: [[Color]] = [
        "#cc8f8f,#805959,#e6cfcf,#bf6060", "#cc9b8f,#806159,#e6d3cf,#bf7360", "#cca78f,#806959,#e6d8cf,#bf8660",
        "#ccae8f,#806c59,#e6dacf,#bf9060", "#ccb48f,#807059,#e6dccf,#bf9960", "#ccba8f,#807459,#e6dfcf,#bfa260",
        "#ccc08f,#807859,#e6e1cf,#bfac60", "#ccc68f,#807c59,#e6e3cf,#bfb660", "#cccc8f,#808059,#e6e6cf,#bfbf60",
        "#c0cc8f,#788059,#e1e6cf,#acbf60", "#b4cc8f,#708059,#dce6cf,#99bf60", "#9bcc8f,#618059,#d3e6cf,#73bf60",
        "#72a372,#598059,#cfe6cf,#60bf60", "#648f7d,#59806f,#cfe6dc,#60bf96", "#567a7a,#598080,#cfe6e6,#60bfbf",
        "#647d8f,#596f80,#cfdce6,#6096bf", "#727ea3,#596380,#cfd4e6,#6078bf", "#6a6a8f,#5f5f80,#d2d2e6,#6d6dbf",
        "#62567a,#665980,#d6cfe6,#8060bf", "#65567a,#695980,#d8cfe6,#8860bf", "#6e567a,#735980,#decfe6,#9f60bf",
        "#7a567a,#805980,#e6cfe6,#bf60bf", "#a37297,#805976,#e6cfe0,#bf60a7", "#b88199,#80596a,#e6cfd9,#bf608a",
    ].map { $0.split(separator: ",").map { hex(String($0)) } }

    static func forRank(_ rankIndex: Int) -> [Color] { rankIndex >= 0 ? colorSchemes[rankIndex % colorSchemes.count] : colorSchemes.last! }
}

/// The RN app's fonts are SF Pro, the system font here
enum Fonts {
    static func rounded(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .rounded) }
    static func text(_ size: CGFloat = 17) -> Font { .system(size: size) }
    static func icons(_ size: CGFloat) -> Font { .custom("icomoon", fixedSize: size) }
}

/// Glyphs of the RN app's icomoon font
enum Icons {
    static let codes: [String: String] = [
        "-Icon-1": "\u{e9a4}",
        "add_outline_28": "\u{e901}",
        "arrow_right_outline_28--forward": "\u{e908}",
        "arrow_uturn_right_outline_28": "\u{e90b}",
        "calendar_outline_28--event": "\u{e913}",
        "cancel_outline_28--close": "\u{e916}",
        "chevron_right_outline_28": "\u{e920}",
        "delete_outline_28-iOS": "\u{e929}",
        "done_outline_28--check": "\u{e92c}",
        "edit_outline_28": "\u{e92f}",
        "list_outline_28": "\u{e94c}",
        "palette_outline_28": "\u{e96b}",
        "reply_outline_28-1": "\u{e9a5}",
        "target_outline_28": "\u{e990}",
    ]
}

let brandGradient = LinearGradient(colors: [Color(UIColor(rgb: 0x1148B9)), Color(UIColor(rgb: 0x5C9BFF))], startPoint: .topLeading, endPoint: .bottomTrailing)
