import Foundation

/// Brzi unos gostiju iz zalijepljenog teksta. Port js/guest-import.js.
///
///     Ana Horvat                 → jedan gost
///     Ana i Marko Horvat         → Ana Horvat + Marko Horvat, sjede zajedno
///     Ivo, Mia, Lea Kovač        → obitelj od troje, sjede zajedno
///     Petar Marić +1             → Petar Marić + "Pratnja (Petar Marić)"
///     Ana Horvat;Prijatelji      → s kategorijom (i s tabulatorom, npr. iz Excela)
///     Horvat Ana / Horvat, Ana   → kad je uključeno "Prezime prvo" (ili zaglavlje "Prezime i ime")
public struct ImportRow: Equatable, Sendable {
    public var names: [String]
    public var category: String?
}

public struct ImportPreview: Equatable, Sendable {
    public var rows: [ImportRow]
    public var guests: Int
    public var groups: Int
    public var skipped: Int
    public var duplicates: [String]
}

public enum GuestImport {
    private static let headerNames = ["ime", "ime i prezime", "prezime i ime", "gost", "gosti", "name"]
    private static let categoryHeaders = ["kategorija", "grupa", "skupina", "category", "strana"]

    private static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static let separators = regex(#"\s*[,&+]\s*|\s+i\s+"#, options: [.caseInsensitive])
    private static let andWord = regex(#"\s+i\s+"#, options: [.caseInsensitive])
    private static let commaPair = regex(#"^\s*([^,&+\s]+)\s*,\s*([^,&+]+?)\s*$"#)
    private static let whitespaceRuns = regex(#"\s+"#)
    private static let digits = regex(#"^[0-9]+$"#)

    private static func fullRange(_ s: String) -> NSRange { NSRange(s.startIndex..., in: s) }

    private static func collapse(_ s: String) -> String {
        whitespaceRuns.stringByReplacingMatches(in: s, range: fullRange(s), withTemplate: " ")
    }

    private static func trim(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// "Horvat Ana" → "Ana Horvat" (prva riječ je prezime).
    static func swapSurname(_ name: String) -> String {
        let words = name.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        return words.count > 1 ? (Array(words.dropFirst()) + [words[0]]).joined(separator: " ") : name
    }

    /// Dijeli tekst kao JavaScriptov `split(regex)`.
    private static func split(_ s: String, by re: NSRegularExpression) -> [String] {
        var parts: [String] = []
        var last = s.startIndex
        for m in re.matches(in: s, range: fullRange(s)) {
            guard let r = Range(m.range, in: s), !r.isEmpty else { continue }
            parts.append(String(s[last..<r.lowerBound]))
            last = r.upperBound
        }
        parts.append(String(s[last...]))
        return parts
    }

    static func splitGroup(_ input: String, surnameFirst: Bool) -> [String] {
        var text = input
        if surnameFirst,
           let m = commaPair.firstMatch(in: text, range: fullRange(text)),
           let r1 = Range(m.range(at: 1), in: text), let r2 = Range(m.range(at: 2), in: text),
           andWord.firstMatch(in: String(text[r2]), range: fullRange(String(text[r2]))) == nil {
            text = String(text[r1]) + " " + String(text[r2])
        }
        let parts = split(text, by: separators).map(trim).filter { !$0.isEmpty }
        var people: [String] = []
        var companions: [Double] = []
        for p in parts {
            if digits.firstMatch(in: p, range: fullRange(p)) != nil {
                companions.append(Double(p) ?? 10)
            } else {
                people.append(collapse(p))
            }
        }
        if surnameFirst {
            let first = people.first
            let surname: String? = (first?.contains(" ") ?? false) ? first!.split(separator: " ", omittingEmptySubsequences: false).first.map(String.init) : nil
            people = people.enumerated().map { i, p in
                p.contains(" ") ? swapSurname(p) : (i > 0 && surname != nil ? p + " " + surname! : p)
            }
        } else if people.count > 1, let last = people.last, last.contains(" ") {
            let surname = last.split(separator: " ", omittingEmptySubsequences: false).dropFirst().joined(separator: " ")
            for i in 0..<(people.count - 1) where !people[i].contains(" ") {
                people[i] += " " + surname
            }
        }
        let host = people.first ?? ""
        let extra = Int(companions.reduce(0) { $0 + min($1, 10) })
        for i in 0..<extra {
            people.append(extra == 1 ? "Pratnja (\(host))" : "Pratnja \(i + 1) (\(host))")
        }
        return host.isEmpty ? [] : people
    }

    private static func splitColumns(_ line: String) -> [String] {
        guard line.contains(where: { $0 == "\t" || $0 == ";" }) else { return [line] }
        return line.components(separatedBy: CharacterSet(charactersIn: "\t;")).map { col in
            var c = trim(col)
            if c.hasPrefix("\"") { c.removeFirst() }
            if c.hasSuffix("\"") { c.removeLast() }
            return c
        }
    }

    private struct Header {
        var ime: Int?
        var prezime: Int?
        var name: Int?
        var category: Int
        var surnameFirst: Bool
    }

    private static func readHeader(_ cols: [String]) -> Header? {
        let lower = cols.map { $0.lowercased() }
        let ime = lower.firstIndex(of: "ime")
        let prezime = lower.firstIndex(of: "prezime")
        let category = lower.firstIndex(where: { categoryHeaders.contains($0) })
        if let ime, let prezime {
            return Header(ime: ime, prezime: prezime, name: nil, category: category ?? -1, surnameFirst: false)
        }
        if let first = lower.first, headerNames.contains(first) {
            return Header(ime: nil, prezime: nil, name: 0, category: category ?? 1, surnameFirst: first == "prezime i ime")
        }
        return nil
    }

    /// Kaže li zalijepljeni popis da je prezime prvo (samo iz zaglavlja, nikad iz imena).
    public static func detectSurnameFirst(_ text: String) -> Bool {
        let first = text.components(separatedBy: CharacterSet(charactersIn: "\r\n")).first { !trim($0).isEmpty }
        guard let first, let h = readHeader(splitColumns(trim(first))) else { return false }
        return h.surnameFirst
    }

    public static func parse(_ text: String, surnameFirst: Bool = false) -> [ImportRow] {
        var rows: [ImportRow] = []
        var header: Header?
        var isFirst = true
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        for line in lines {
            let trimmed = trim(line)
            if trimmed.isEmpty { continue }
            let cols = splitColumns(trimmed)
            func col(_ i: Int) -> String? { i >= 0 && i < cols.count ? cols[i] : nil }
            if isFirst {
                isFirst = false
                header = readHeader(cols)
                if header != nil { continue }
            }
            if let h = header, let ime = h.ime, let prezime = h.prezime {
                let nameText = [col(ime), col(prezime)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
                let category = h.category >= 0 ? col(h.category) : nil
                if !nameText.isEmpty {
                    rows.append(ImportRow(names: [collapse(nameText)], category: (category ?? "").isEmpty ? nil : category))
                }
                continue
            }
            let nameText = col(header?.name ?? 0)
            let category = col(header?.category ?? 1)
            let names = splitGroup(nameText ?? "", surnameFirst: surnameFirst)
            if !names.isEmpty {
                rows.append(ImportRow(names: names, category: (category ?? "").isEmpty ? nil : category))
            }
        }
        return rows
    }

    /// Što bi uvoz dodao. Imena koja već postoje se preskaču osim uz `includeExisting`.
    public static func preview(_ rows: [ImportRow], existingNames: [String], includeExisting: Bool = false) -> ImportPreview {
        let existing = Set(existingNames.map { $0.lowercased() })
        var guests = 0, groups = 0, skipped = 0
        var duplicates: [String] = []
        var kept: [ImportRow] = []
        for row in rows {
            let names = row.names.filter { n in
                if !existing.contains(n.lowercased()) { return true }
                if !duplicates.contains(n) { duplicates.append(n) }
                if includeExisting { return true }
                skipped += 1
                return false
            }
            if names.isEmpty { continue }
            guests += names.count
            if names.count > 1 { groups += 1 }
            kept.append(ImportRow(names: names, category: row.category))
        }
        return ImportPreview(rows: kept, guests: guests, groups: groups, skipped: skipped, duplicates: duplicates)
    }
}
