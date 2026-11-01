import SwiftUI
import UIKit

/// Boje iz web aplikacije (css/app.css, "Design tokens").
enum Theme {
    // Svijetle boje su iz weba; tamne su meke (ne crne) i prate zadani iOS tamni način.
    static let background = dynamic(light: 0xFDFBF7, dark: 0x1C1C1E)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x2C2C2E)
    static let champagne = dynamic(light: 0xF5EBDD, dark: 0x3A342B)
    static let border = dynamic(light: 0xE8DCC8, dark: 0x48423A)
    static let gold = Color(hex: 0xC9A24B)
    static let goldDeep = dynamic(light: 0xA17C33, dark: 0xD8B565)
    static let bronze = dynamic(light: 0x6B5836, dark: 0xCDB892)
    static let ink = dynamic(light: 0x2B2622, dark: 0xF2EDE4)
    static let muted = dynamic(light: 0x8A7F70, dark: 0xA39A8C)
    /// Pun stol u tlocrtu.
    static let tableFull = dynamic(light: 0xF3F8F1, dark: 0x2F3A2F)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        func ui(_ hex: UInt32) -> UIColor {
            UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                    blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        }
        return Color(UIColor { $0.userInterfaceStyle == .dark ? ui(dark) : ui(light) })
    }

    /// Zadani iOS fontovi (San Francisco) sa sistemskim stilovima, pa se tekst
    /// prilagođava postavci veličine teksta (Dynamic Type). Veličine iz dizajna
    /// se preslikavaju na najbliži stil.
    private static func style(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case ..<12.5: return .caption
        case ..<14.5: return .footnote
        case ..<15.5: return .subheadline
        case ..<16.5: return .callout
        case ..<18: return .body
        case ..<22: return .title3
        case ..<28: return .title2
        default: return .title
        }
    }
    static func title(_ size: CGFloat = 28) -> Font { .system(style(for: size), weight: .semibold) }
    static func ui(_ size: CGFloat = 16) -> Font { .system(style(for: size)) }
    static func uiBold(_ size: CGFloat = 16) -> Font { .system(style(for: size), weight: .semibold) }
    /// Nepromjenjiva veličina, za natpise unutar tlocrta (crtaju se u svijetu sale).
    static func fixed(_ size: CGFloat, weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }

    /// Boja trake i naslova kao u web aplikaciji.
    static func applyAppearance() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(background)
        nav.titleTextAttributes = [
            .foregroundColor: UIColor(ink)
        ]
        nav.largeTitleTextAttributes = [
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

extension Theme {
    /// Boje mjesta: mladenci, kumovi s partnerima i ostali gosti (isto kao web).
    static let seatCouple = Color(hex: 0x8A5A7E)
    static let seatKumovi = Color(hex: 0x5E7F99)
    static let success = Color(hex: 0x5C8A5C)
    static let error = Color(hex: 0xB04A3F)
}
