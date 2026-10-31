import SwiftUI

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

    /// Naslovi: serifni font. Cormorant se ugrađuje kasnije; do tada sustavni serif.
    static func title(_ size: CGFloat = 28) -> Font {
        .system(size: size, weight: .semibold, design: .serif)
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
