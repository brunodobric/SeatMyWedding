import Foundation

/// Jedan zapis (gost, stol, kategorija, pravilo ili postavke) kao JSON objekt.
///
/// Zapis namjerno nije kruta struktura: web aplikacija može dodati nova polja, a
/// iPhone ih mora sačuvati kad sprema podatke natrag u oblak. Tipizirani prikazi
/// (Gost, Stol…) dolaze kasnije kao tanak sloj iznad ovoga.
public struct Record: Equatable, Sendable {
    public var fields: [String: JSONValue]

    public init(_ fields: [String: JSONValue] = [:]) {
        self.fields = fields
    }

    public subscript(key: String) -> JSONValue? {
        get { fields[key] }
        set { fields[key] = newValue }
    }

    public var id: String? { fields["id"]?.stringValue }

    public func string(_ key: String) -> String? { fields[key]?.stringValue }

    public func number(_ key: String) -> Double? { fields[key]?.numberValue }

    public func isTruthy(_ key: String) -> Bool { fields[key]?.isTruthy ?? false }

    /// Cijeli broj (kao JavaScriptov Number.isInteger).
    public func integer(_ key: String) -> Double? {
        guard let n = number(key), n.isFinite, n == n.rounded() else { return nil }
        return n
    }

    public var json: JSONValue { .object(fields) }
}

extension Record: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self.fields = try c.decode([String: JSONValue].self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(fields)
    }
}

/// Cijelo vjenčanje: postavke, stolovi, kategorije, gosti i pravila.
public struct WeddingData: Equatable, Sendable {
    public var settings: Record
    public var tables: [Record]
    public var categories: [Record]
    public var guests: [Record]
    public var rules: [Record]

    public init(
        settings: Record = Record(["id": .string("main"), "weddingTitle": .string(""), "monogram": .string("")]),
        tables: [Record] = [],
        categories: [Record] = [],
        guests: [Record] = [],
        rules: [Record] = []
    ) {
        self.settings = settings
        self.tables = tables
        self.categories = categories
        self.guests = guests
        self.rules = rules
    }

    public var json: JSONValue {
        .object([
            "settings": settings.json,
            "tables": .array(tables.map { $0.json }),
            "categories": .array(categories.map { $0.json }),
            "guests": .array(guests.map { $0.json }),
            "rules": .array(rules.map { $0.json })
        ])
    }
}


extension Double {
    /// Cijeli broj bez rušenja aplikacije kad podaci sadrže NaN ili ogromne brojeve.
    public var safeInt: Int { isFinite ? Int(max(-1e9, min(1e9, self))) : 0 }
}
