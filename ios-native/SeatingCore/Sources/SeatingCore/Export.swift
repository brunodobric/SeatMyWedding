import Foundation

/// Izvoz i ispis rasporeda. Port tekstova iz js/app.js (CSV, "gdje sjedim", ispis).
public struct PrintTable: Equatable, Sendable {
    public var name: String
    public var guests: [String]
}

public struct PrintRow: Equatable, Sendable {
    public var name: String
    public var table: String
}

extension WeddingData {
    private func tableName(_ id: String?) -> String {
        guard let id else { return "" }
        return tables.first { $0.id == id }?.string("name") ?? ""
    }

    private func nameOrder(_ a: Record, _ b: Record) -> Bool {
        let hr = Locale(identifier: "hr")
        let r = (a.string("name") ?? "").compare(b.string("name") ?? "", options: [.caseInsensitive], range: nil, locale: hr)
        return r == .orderedAscending
    }

    /// Gost s ulogom u zagradi za mladenaca i kumove: "Ana (Mladenka)".
    private func displayName(_ g: Record, parentheses: Bool) -> String {
        let name = g.string("name") ?? ""
        let role = WeddingParty.role(g)
        if role.isEmpty { return name }
        return parentheses ? "\(name) (\(role))" : "\(name) · \(role)"
    }

    /// CSV svih gostiju (s BOM-om da Excel ispravno prikaže č, ć, š, ž).
    public func csv() -> String {
        var rows: [[String]] = [["Ime", "Uloga", "Kategorija", "Stol", "Mjesto", "Status", "Bilješka"]]
        let labels = ["assigned": "Dodijeljen", "unassigned": "Nedodijeljen", "maybe": "Možda"]
        for g in guests.sorted(by: nameOrder) {
            let cat = categories.first { $0.id == g.string("categoryId") }?.string("name") ?? ""
            let tid = g.string("tableId") ?? ""
            var seat = ""
            if !tid.isEmpty, let s = g.number("seatIndex") { seat = Self.formatNumber(s + 1) }
            let status = g.string("status") ?? ""
            rows.append([g.string("name") ?? "", WeddingParty.role(g), cat, tableName(tid.isEmpty ? nil : tid), seat,
                         labels[status] ?? status, g.string("notes") ?? ""])
        }
        // Ćelija koja počinje s = + - @ u Excelu bi se izvršila kao formula.
        func cell(_ c: String) -> String {
            let escaped = c.replacingOccurrences(of: "\"", with: "\"\"")
            if let f = c.unicodeScalars.first, "=+-@\t\r".unicodeScalars.contains(f) { return "'" + escaped }
            return escaped
        }
        let body = rows.map { $0.map { "\"\(cell($0))\"" }.joined(separator: ",") }.joined(separator: "\r\n")
        return "\u{FEFF}" + body
    }

    static func formatNumber(_ n: Double) -> String {
        n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
    }

    /// Gosti koji sjede za postojećim stolom, abecedno.
    private func seatedSorted() -> [Record] {
        guests.filter { g in
            guard let t = g.string("tableId"), !t.isEmpty else { return false }
            return tables.contains { $0.id == t }
        }.sorted(by: nameOrder)
    }

    /// Retci "Ime (uloga) – Stol" za dijeljenje; prazno ako nitko nema mjesto.
    public func seatingListLines() -> [String] {
        seatedSorted().map { "\(displayName($0, parentheses: true)) – \(tableName($0.string("tableId")))" }
    }

    public func seatingShareText() -> String? {
        let lines = seatingListLines()
        if lines.isEmpty { return nil }
        let title = settings.string("weddingTitle").flatMap { $0.isEmpty ? nil : $0 } ?? "Vjenčanje"
        return "\(title) – gdje sjedim\n\n" + lines.joined(separator: "\n")
    }

    /// Za ispis po stolovima: stol po stol, gosti po mjestu.
    public func printTables() -> [PrintTable] {
        tables.map { t in
            let seated = guests.enumerated().filter { $0.element.string("tableId") == t.id }.sorted { a, b in
                let sa = a.element.number("seatIndex") ?? 0, sb = b.element.number("seatIndex") ?? 0
                return sa != sb ? sa < sb : a.offset < b.offset
            }
            return PrintTable(name: t.string("name") ?? "", guests: seated.map { displayName($0.element, parentheses: false) })
        }
    }

    /// Za ispis "Gdje sjedim": abecedno ime i stol.
    public func printAlphabetical() -> [PrintRow] {
        seatedSorted().map { PrintRow(name: displayName($0, parentheses: false), table: tableName($0.string("tableId"))) }
    }

    /// Sigurnosna kopija kao JSON (isti oblik kao web izvoz).
    public func backupJSONString() -> String {
        let data = (try? JSONEncoder.pretty.encode(json)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return e
    }
}
