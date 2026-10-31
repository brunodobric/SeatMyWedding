import Foundation

/// Podaci mogu doći iz sigurnosne kopije ili iz oblaka pa im se ne vjeruje:
/// id-jevi i boje završavaju u prikazu, brojevi se zbrajaju. Zapisi bez ispravnog
/// id-a se odbacuju, boje moraju biti heksadecimalne, brojevi moraju biti brojevi.
/// Imena i bilješke ostaju kakvi jesu. Port funkcije cleanData iz js/state.js.
///
/// Namjerna odstupanja od JavaScripta (rubni slučajevi koje web ne obrađuje
/// ispravno): zapis bez id-a se odbacuje (web ga zadrži kao "undefined"), id-jevi
/// koji nisu tekst smatraju se neispravnima, a brojčana polja koja su polje ili
/// objekt postaju null.
public enum DataCleaning {
    static let numberFields = ["seats", "seatIndex", "x", "y", "rotation", "seatsLong", "seatsEnd", "updatedAt"]
    static let idFields = ["tableId", "categoryId"]
    static let defaultColor = "#C9A24B"

    /// /^[A-Za-z0-9_-]{1,64}$/
    public static func isSafeID(_ s: String) -> Bool {
        let scalars = Array(s.unicodeScalars)
        guard scalars.count >= 1, scalars.count <= 64 else { return false }
        return scalars.allSatisfy { u in
            (u.value >= 0x30 && u.value <= 0x39) || (u.value >= 0x41 && u.value <= 0x5A)
                || (u.value >= 0x61 && u.value <= 0x7A) || u == "_" || u == "-"
        }
    }

    /// /^#[0-9A-Fa-f]{3,8}$/
    public static func isSafeColor(_ s: String) -> Bool {
        let scalars = Array(s.unicodeScalars)
        guard scalars.count >= 4, scalars.count <= 9, scalars[0] == "#" else { return false }
        return scalars.dropFirst().allSatisfy { u in
            (u.value >= 0x30 && u.value <= 0x39) || (u.value >= 0x41 && u.value <= 0x46)
                || (u.value >= 0x61 && u.value <= 0x66)
        }
    }

    /// JavaScriptov Number(tekst): prazan ili razmaci → 0, inače broj ili nil.
    static func parseNumber(_ s: String) -> Double? {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        guard let n = Double(trimmed), n.isFinite else { return nil }
        return n
    }

    /// JavaScriptov String(vrijednost).
    static func jsString(_ v: JSONValue) -> String {
        switch v {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .string(let s): return s
        case .number(let n):
            if n == n.rounded() && abs(n) < 1e15 { return String(Int64(n)) }
            return "\(n)"
        case .array(let a):
            return a.map { item -> String in
                if case .null = item { return "" }
                return jsString(item)
            }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    public static func cleanRecord(_ value: JSONValue) -> Record? {
        guard case .object(var out) = value,
              case .string(let id)? = out["id"],
              isSafeID(id) else { return nil }

        for key in numberFields {
            guard let v = out[key] else { continue }
            switch v {
            case .null, .number:
                continue
            case .string(let s):
                if s.isEmpty { out[key] = .null }
                else if let n = parseNumber(s) { out[key] = .number(n) }
                else { out[key] = .null }
            case .bool(let b):
                out[key] = .number(b ? 1 : 0)
            default:
                out[key] = .null
            }
        }

        for key in idFields {
            guard let v = out[key] else { continue }
            if case .null = v { continue }
            if case .string(let s) = v, isSafeID(s) { continue }
            out[key] = .null
        }

        if let g = out["guestIds"] {
            if case .array(let items) = g {
                out["guestIds"] = .array(items.filter { item in
                    if case .string(let s) = item { return isSafeID(s) }
                    return false
                })
            } else {
                out["guestIds"] = .array([])
            }
        }

        if let c = out["color"] {
            if case .string(let s) = c, isSafeColor(s) {
                // ostaje
            } else {
                out["color"] = .string(defaultColor)
            }
        }

        if let n = out["name"] {
            switch n {
            case .string: break
            case .null: out["name"] = .string("")
            default: out["name"] = .string(jsString(n))
            }
        }

        return Record(out)
    }

    /// `raw` je objekt { settings, tables, categories, guests, rules }.
    public static func cleanData(_ raw: JSONValue) -> WeddingData {
        let top = raw.objectValue ?? [:]

        var settings = top["settings"]?.objectValue ?? [:]
        settings["id"] = .string("main")
        settings["weddingTitle"] = .string(settings["weddingTitle"]?.stringValue ?? "")
        settings["monogram"] = .string(settings["monogram"]?.stringValue ?? "")

        func list(_ key: String) -> [Record] {
            guard let items = top[key]?.arrayValue else { return [] }
            return items.compactMap { cleanRecord($0) }
        }

        return WeddingData(
            settings: Record(settings),
            tables: list("tables"),
            categories: list("categories"),
            guests: list("guests"),
            rules: list("rules")
        )
    }
}

// MARK: - Popravci nakon učitavanja

extension WeddingData {
    /// Stariji stolovi mladenaca spremljeni su s dvostruko više mjesta nego što je
    /// nacrtano; sada se crtaju sva. Vraća id-jeve promijenjenih stolova.
    @discardableResult
    public mutating func migrateTables() -> [String] {
        var changed: [String] = []
        for i in tables.indices {
            let t = tables[i]
            guard t.string("shape") == "head", let long = t.integer("seatsLong") else { continue }
            let end = t.number("seatsEnd") ?? 0
            let seats = t.number("seats")
            let matches = seats != nil && long + 2 * end == seats!
            if matches { continue }
            if t["seats"] == nil {
                // JavaScript: undefined - n = NaN, a to se sprema kao null.
                tables[i]["seatsLong"] = .null
            } else {
                tables[i]["seatsLong"] = .number(max(0, (seats ?? 0) - 2 * end))
            }
            if let id = t.id { changed.append(id) }
        }
        return changed
    }

    /// Nakon spajanja dva uređaja na jednom mjestu mogu biti dva gosta, ili gost
    /// može sjediti za stolom kojeg je drugi uređaj obrisao. Mjesto zadržava gost
    /// koji je zadnji smješten (zaključan ima prednost); ostali postaju "bez mjesta".
    /// Vraća id-jeve gostiju koji su vraćeni na "bez mjesta", redom kojim su obrađeni.
    @discardableResult
    public mutating func repairSeating() -> [String] {
        var seatsByTable: [String: Double] = [:]
        for t in tables {
            // null je 0, a nedostajuće polje je NaN (svaka usporedba s njim je neistina).
            if let id = t.id { seatsByTable[id] = t.number("seats") ?? (t["seats"] == nil ? Double.nan : 0) }
        }

        let seated = guests.indices.filter { !(guests[$0].string("tableId") ?? "").isEmpty }
        let ordered = seated.sorted { a, b in
            let ga = guests[a], gb = guests[b]
            let la = ga.isTruthy("locked"), lb = gb.isTruthy("locked")
            if la != lb { return la }
            let ua = ga.number("updatedAt") ?? 0, ub = gb.number("updatedAt") ?? 0
            if ua != ub { return ua > ub }
            return (ga.id ?? "") < (gb.id ?? "")
        }

        var taken = Set<String>()
        var freed: [Int] = []
        for i in ordered {
            let g = guests[i]
            guard let tableId = g.string("tableId"), let seats = seatsByTable[tableId] else {
                freed.append(i)
                continue
            }
            guard let seat = g.integer("seatIndex") else { continue }
            let key = tableId + ":" + "\(seat + 0)"
            if seat < 0 || seat >= seats || taken.contains(key) {
                freed.append(i)
            } else {
                taken.insert(key)
            }
        }

        var ids: [String] = []
        for i in freed {
            guests[i]["tableId"] = .null
            guests[i]["seatIndex"] = .null
            if guests[i].string("status") == "assigned" { guests[i]["status"] = .string("unassigned") }
            if let id = guests[i].id { ids.append(id) }
        }
        return ids
    }
}
