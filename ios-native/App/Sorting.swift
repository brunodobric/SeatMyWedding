import SwiftUI
import SeatingCore

/// Redoslijed popisa gostiju.
enum GuestSort: String, CaseIterable, Identifiable {
    case name, surname
    var id: String { rawValue }
    var label: String { self == .name ? "Abecedno po imenu" : "Abecedno po prezimenu" }

    /// Prezime je zadnja riječ imena; kod jednakih prezimena odlučuje ime.
    func sorted(_ guests: [Record]) -> [Record] {
        func name(_ g: Record) -> String { g.string("name") ?? "" }
        func surname(_ g: Record) -> String { name(g).split(separator: " ").last.map(String.init) ?? "" }
        func less(_ a: String, _ b: String) -> Bool { a.localizedCaseInsensitiveCompare(b) == .orderedAscending }
        func same(_ a: String, _ b: String) -> Bool { a.localizedCaseInsensitiveCompare(b) == .orderedSame }
        return guests.sorted {
            if self == .surname, !same(surname($0), surname($1)) { return less(surname($0), surname($1)) }
            return less(name($0), name($1))
        }
    }
}

/// Redoslijed popisa stolova.
enum TableSort: String, CaseIterable, Identifiable {
    case number, name, fullest, emptiest
    var id: String { rawValue }
    var label: String {
        switch self {
        case .number: return "Po rednom broju"
        case .name: return "Abecedno po nazivu"
        case .fullest: return "Najpopunjeniji prvo"
        case .emptiest: return "Najpraznije prvo"
        }
    }

    @MainActor func sorted(_ tables: [Record], in store: WeddingStore) -> [Record] {
        func fill(_ t: Record) -> Double {
            let seats = Double(max(1, FloorGeometry.count(t.number("seats"))))
            return Double(store.guests.filter { $0.string("tableId") == t.id }.count) / seats
        }
        func name(_ t: Record) -> String { t.string("name") ?? "" }
        let index = Dictionary(uniqueKeysWithValues: store.tables.enumerated().compactMap { i, t in t.id.map { ($0, i) } })
        func byNumber(_ a: Record, _ b: Record) -> Bool {
            let na = store.tableNumber(a), nb = store.tableNumber(b)
            if na != nb { return na < nb }
            return (index[a.id ?? ""] ?? 0) < (index[b.id ?? ""] ?? 0)
        }
        return tables.sorted { a, b in
            switch self {
            case .number: return byNumber(a, b)
            case .name:
                let c = name(a).localizedStandardCompare(name(b))
                return c == .orderedSame ? byNumber(a, b) : c == .orderedAscending
            case .fullest, .emptiest:
                let fa = fill(a), fb = fill(b)
                if fa == fb { return byNumber(a, b) }
                return self == .fullest ? fa > fb : fa < fb
            }
        }
    }
}
