import SwiftUI
import UIKit

/// Boje iz web aplikacije (css/app.css, "Design tokens").
enum Theme {
    static let background = Color(hex: 0xFDFBF7)
    static let surface = Color.white
    static let champagne = Color(hex: 0xF5EBDD)
    static let border = Color(hex: 0xE8DCC8)
    static let gold = Color(hex: 0xC9A24B)
    static let goldDeep = Color(hex: 0xA17C33)
    static let bronze = Color(hex: 0x6B5836)
    static let ink = Color(hex: 0x2B2622)
    static let muted = Color(hex: 0x8A7F70)

    /// Fontovi iz web aplikacije (OFL licenca, mapa App/Fonts): Cormorant Garamond
    /// za naslove, Jost za sučelje, Pinyon Script za monogram.
    static let serifRegular = "CormorantGaramond-Regular"
    static let serifSemiBold = "CormorantGaramond-SemiBold"
    static let uiRegular = "Jost-Regular"
    static let uiMedium = "Jost-Medium"
    static let uiSemiBold = "Jost-SemiBold"
    static let scriptName = "PinyonScript-Regular"

    static func title(_ size: CGFloat = 28) -> Font { .custom(serifSemiBold, size: size) }
    static func ui(_ size: CGFloat = 16) -> Font { .custom(uiRegular, size: size) }
    static func uiBold(_ size: CGFloat = 16) -> Font { .custom(uiSemiBold, size: size) }
    static func script(_ size: CGFloat = 36) -> Font { .custom(scriptName, size: size) }

    /// Naslovi navigacije i boja trake kao u web aplikaciji.
    static func applyAppearance() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(background)
        nav.titleTextAttributes = [
            .font: UIFont(name: serifSemiBold, size: 20) ?? .systemFont(ofSize: 20, weight: .semibold),
            .foregroundColor: UIColor(ink)
        ]
        nav.largeTitleTextAttributes = [
            .font: UIFont(name: serifSemiBold, size: 34) ?? .systemFont(ofSize: 34, weight: .semibold),
            .foregroundColor: UIColor(ink)
        ]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension Color {
    /// Boja kategorije iz podataka (#RGB, #RRGGBB ili #RRGGBBAA); inače zlatna.
    init(cssHex: String?) {
        guard var h = cssHex, h.hasPrefix("#") else { self = Theme.gold; return }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6 || h.count == 8, let v = UInt32(h.prefix(6), radix: 16) else { self = Theme.gold; return }
        self.init(hex: v)
    }
}
