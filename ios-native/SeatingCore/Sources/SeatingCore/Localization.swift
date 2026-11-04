import Foundation

/// Tekstovi koje jezgra daje korisniku (poruke, izvoz, nazivi novih stolova).
/// Jezgra ih piše na hrvatskom, isto kao web, pa testovi i golden.json ostaju isti.
/// Aplikacija pri pokretanju postavi `translate` (Localizable.strings) i tada se
/// prikazuju na jeziku aplikacije. Ključ je hrvatski tekst s %@ / %lld za vrijednosti
/// (prijevod smije promijeniti redoslijed: %2$@ … %1$@).
public enum CoreText {
    public static var translate: (String) -> String = { $0 }

    static func t(_ key: String) -> String { translate(key) }

    static func t(_ key: String, _ args: Any...) -> String { format(translate(key), args) }

    private static let placeholder = try! NSRegularExpression(pattern: #"%%|%(?:([0-9]+)\$)?(@|lld|ld|d)"#)

    /// Isto što String(format:) za %@ i %lld, ali radi i na Linuxu sa Swift tipovima.
    static func format(_ f: String, _ args: [Any]) -> String {
        var out = ""
        var last = f.startIndex
        var next = 0
        for m in placeholder.matches(in: f, range: NSRange(f.startIndex..., in: f)) {
            guard let r = Range(m.range, in: f) else { continue }
            out += f[last..<r.lowerBound]
            if f[r] == "%%" {
                out += "%"
            } else {
                var i = next
                if let p = Range(m.range(at: 1), in: f), let n = Int(f[p]) { i = n - 1 } else { next += 1 }
                if i >= 0 && i < args.count { out += "\(args[i])" }
            }
            last = r.upperBound
        }
        return out + f[last...]
    }
}
