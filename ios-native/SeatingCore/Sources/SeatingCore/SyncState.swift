import Foundation

/// Stanje za sinkronizaciju: zapisi po vrstama i nadgrobni zapisi (obrisano).
/// Spajanje je zapis po zapis, pobjeđuje zadnja promjena. Port funkcija
/// mergeSyncStates, fromCloudDoc i toCloudDoc iz js/sync.js; oblik dokumenta u
/// Firestoreu (users/{uid}/data/wedding) mora ostati isti kao na webu.
public struct SyncState: Equatable, Sendable {
    public static let stores = ["settings", "tables", "categories", "guests", "rules"]
    public static let syncVersion = 2
    public static let tombstoneDays = 180.0

    public var records: [String: [Record]]
    /// store → (id zapisa → vrijeme brisanja u ms)
    public var deleted: [String: [String: Double]]
    public var version: Double?
    public var updatedAt: Double?

    public init(
        records: [String: [Record]] = [:],
        deleted: [String: [String: Double]] = [:],
        version: Double? = nil,
        updatedAt: Double? = nil
    ) {
        var r = records
        var d = deleted
        for store in SyncState.stores {
            if r[store] == nil { r[store] = [] }
            if d[store] == nil { d[store] = [:] }
        }
        self.records = r
        self.deleted = d
        self.version = version
        self.updatedAt = updatedAt
    }

    // MARK: JSON

    /// Iz oblika { records: {store: [..]}, deleted: {store: {id: ts}}, version?, updatedAt? }.
    public init(json: JSONValue) {
        let top = json.objectValue ?? [:]
        var r: [String: [Record]] = [:]
        var d: [String: [String: Double]] = [:]
        for store in SyncState.stores {
            r[store] = (top["records"]?.objectValue?[store]?.arrayValue ?? []).compactMap { v in
                v.objectValue.map { Record($0) }
            }
            var del: [String: Double] = [:]
            for (id, ts) in top["deleted"]?.objectValue?[store]?.objectValue ?? [:] {
                if let n = ts.numberValue { del[id] = n }
            }
            d[store] = del
        }
        self.init(records: r, deleted: d,
                  version: top["version"]?.numberValue, updatedAt: top["updatedAt"]?.numberValue)
    }

    public func toJSON() -> JSONValue {
        var recs: [String: JSONValue] = [:]
        var dels: [String: JSONValue] = [:]
        for store in SyncState.stores {
            recs[store] = .array((records[store] ?? []).map { $0.json })
            dels[store] = .object((deleted[store] ?? [:]).mapValues { JSONValue.number($0) })
        }
        var out: [String: JSONValue] = ["records": .object(recs), "deleted": .object(dels)]
        if let v = version { out["version"] = .number(v) }
        if let u = updatedAt { out["updatedAt"] = .number(u) }
        return .object(out)
    }

    // MARK: Spajanje

    /// Za svaki zapis pobjeđuje novija promjena, bila to izmjena ili brisanje.
    /// Kod jednakog vremena pobjeđuje `b` ako je `preferB` (obje kopije su starije
    /// od syncVersion 2). `now` je trenutno vrijeme u ms; nadgrobni zapisi stariji
    /// od 180 dana se bacaju.
    public static func merge(_ a: SyncState, _ b: SyncState, preferB: Bool, now: Double) -> SyncState {
        var out = SyncState()
        let cutoff = now - tombstoneDays * 864e5
        for store in stores {
            var ra: [String: Record] = [:]
            var rb: [String: Record] = [:]
            var ids: [String] = []
            var seen = Set<String>()
            func add(_ id: String) {
                if seen.insert(id).inserted { ids.append(id) }
            }
            for r in a.records[store] ?? [] { if let id = r.id { ra[id] = r; add(id) } }
            for r in b.records[store] ?? [] { if let id = r.id { rb[id] = r; add(id) } }
            let da = a.deleted[store] ?? [:]
            let db = b.deleted[store] ?? [:]
            for id in da.keys.sorted() { add(id) }
            for id in db.keys.sorted() { add(id) }

            for id in ids {
                let x = ra[id], y = rb[id]
                var rec = x ?? y
                if let x = x, let y = y {
                    let tx = x.number("updatedAt") ?? 0
                    let ty = y.number("updatedAt") ?? 0
                    rec = (ty > tx || (ty == tx && preferB)) ? y : x
                }
                let deletedAt = max(da[id] ?? 0, db[id] ?? 0)
                if let rec = rec, (rec.number("updatedAt") ?? 0) > deletedAt {
                    out.records[store, default: []].append(rec)
                } else if let rec = rec, deletedAt == 0 {
                    out.records[store, default: []].append(rec)
                } else if deletedAt > cutoff {
                    out.deleted[store, default: [:]][id] = deletedAt
                }
            }
        }
        return out
    }

    /// Jesu li dva stanja ista (zapisi po id-u; od nadgrobnih zapisa samo id-jevi).
    public func isEquivalent(to other: SyncState) -> Bool {
        for store in SyncState.stores {
            let ra = (records[store] ?? []).sorted { ($0.id ?? "") < ($1.id ?? "") }
            let rb = (other.records[store] ?? []).sorted { ($0.id ?? "") < ($1.id ?? "") }
            if ra != rb { return false }
            if Set((deleted[store] ?? [:]).keys) != Set((other.deleted[store] ?? [:]).keys) { return false }
        }
        return true
    }

    // MARK: Dokument u oblaku

    /// Iz Firestore dokumenta. Dokument bez `syncVersion` napisala je starija
    /// verzija aplikacije i vodi se kao verzija 1.
    public static func fromCloudDoc(_ data: JSONValue?) -> SyncState {
        guard let doc = data?.objectValue else { return SyncState() }
        var r: [String: [Record]] = [:]
        var d: [String: [String: Double]] = [:]
        if let s = doc["settings"], s.isTruthy, var fields = s.objectValue {
            fields["id"] = .string("main")
            r["settings"] = [Record(fields)]
        }
        for store in ["tables", "categories", "guests", "rules"] {
            r[store] = (doc[store]?.arrayValue ?? []).compactMap { v in v.objectValue.map { Record($0) } }
        }
        for store in stores {
            var del: [String: Double] = [:]
            for (id, ts) in doc["deleted"]?.objectValue?[store]?.objectValue ?? [:] {
                if let n = ts.numberValue { del[id] = n }
            }
            d[store] = del
        }
        let version = doc["syncVersion"]?.numberValue
        let updated = doc["updatedAt"]?.numberValue
        return SyncState(
            records: r, deleted: d,
            version: (version != nil && version != 0) ? version : 1,
            updatedAt: updated ?? 0
        )
    }

    /// U Firestore dokument. Izračunato polje `satisfied` na pravilima se ne sprema.
    public func toCloudDoc(now: Double) -> JSONValue {
        let defaultSettings = Record(["id": .string("main"), "weddingTitle": .string(""), "monogram": .string("")])
        func strip(_ r: Record) -> JSONValue {
            var c = r
            c["satisfied"] = nil
            return c.json
        }
        var dels: [String: JSONValue] = [:]
        for store in SyncState.stores {
            dels[store] = .object((deleted[store] ?? [:]).mapValues { JSONValue.number($0) })
        }
        let doc: JSONValue = .object([
            "syncVersion": .number(Double(SyncState.syncVersion)),
            "updatedAt": .number(now),
            "settings": (records["settings"]?.first ?? defaultSettings).json,
            "tables": .array((records["tables"] ?? []).map { $0.json }),
            "categories": .array((records["categories"] ?? []).map { $0.json }),
            "guests": .array((records["guests"] ?? []).map { $0.json }),
            "rules": .array((records["rules"] ?? []).map { strip($0) }),
            "deleted": .object(dels)
        ])
        return doc.sanitized()
    }
}

// MARK: - Lokalne izmjene (kao js/db.js)

extension SyncState {
    /// Zapisi se spremaju s novim `updatedAt`, a nadgrobni zapis (ako ga je bilo)
    /// nestaje, npr. kad se brisanje poništi. Isto kao dbPutAll na webu.
    public mutating func put(_ store: String, _ items: [Record], now: Double) {
        for item in items {
            guard let id = item.id else { continue }
            var rec = item
            rec["updatedAt"] = .number(now)
            var list = records[store] ?? []
            if let i = list.firstIndex(where: { $0.id == id }) {
                list[i] = rec
            } else {
                list.append(rec)
            }
            records[store] = list
            deleted[store]?[id] = nil
        }
    }

    /// Briše zapise i ostavlja nadgrobne zapise, da ih drugi uređaj ne vrati.
    public mutating func remove(_ store: String, ids: [String], now: Double) {
        let gone = Set(ids)
        records[store] = (records[store] ?? []).filter { !gone.contains($0.id ?? "") }
        for id in ids { deleted[store, default: [:]][id] = now }
    }

    /// Cijelo vjenčanje kao što ga vide ekrani.
    public var wedding: WeddingData {
        WeddingData(
            settings: records["settings"]?.first ?? WeddingData().settings,
            tables: records["tables"] ?? [],
            categories: records["categories"] ?? [],
            guests: records["guests"] ?? [],
            rules: records["rules"] ?? []
        )
    }

    /// Stanje iz čistih podataka (npr. uvezena kopija): svaki zapis dobiva `updatedAt`.
    public init(wedding: WeddingData, now: Double) {
        self.init()
        put("settings", [wedding.settings], now: now)
        put("tables", wedding.tables, now: now)
        put("categories", wedding.categories, now: now)
        put("guests", wedding.guests, now: now)
        put("rules", wedding.rules, now: now)
    }
}
