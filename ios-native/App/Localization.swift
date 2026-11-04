import Foundation
import SeatingCore

/// Jezik aplikacije. Tekstovi u kodu su hrvatski originali; prijevodi su u
/// `en.lproj/Localizable.strings` (množina u `Localizable.stringsdict`, i za hrvatski).
/// iOS sam bira jezik prema postavkama telefona, a korisnik ga može promijeniti u
/// Postavke → SeatMyWedding → Jezik.
///
/// Novi jezik: dodaj mapu `<kod>.lproj` s prevedenim `Localizable.strings` i
/// `Localizable.stringsdict` i kod u `CFBundleLocalizations` u `project.yml`.
enum AppLanguage {
    /// Jezik u kojem aplikacija radi ("hr", "en").
    static var code: String { Bundle.main.preferredLocalizations.first ?? "hr" }

    /// Za datume i brojeve: jezik aplikacije s regijom uređaja.
    static var locale: Locale {
        if let region = Locale.current.region?.identifier { return Locale(identifier: "\(code)_\(region)") }
        return Locale(identifier: code == "hr" ? "hr_HR" : code)
    }

    /// Naziv jezika na tom jeziku ("Hrvatski", "English").
    static var currentName: String {
        let l = Locale(identifier: code)
        return l.localizedString(forLanguageCode: code)?.capitalized(with: l) ?? code
    }

    /// "Ana i Marko" / "Ana and Marko".
    static func join(_ items: [String]) -> String {
        items.formatted(.list(type: .and).locale(locale))
    }

    /// Tekstovi iz SeatingCore (poruke, izvoz, nazivi stolova) prevode se iz Localizable.strings.
    static func setUp() {
        CoreText.translate = { NSLocalizedString($0, comment: "") }
    }
}
