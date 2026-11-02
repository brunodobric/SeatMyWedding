import Foundation

/// Lokalna datoteka s podacima vjenčanja (wedding.json): oblik, verzija oblika, učitavanje i
/// spremanje. Nalazi se u paketu, a ne u aplikaciji, da se može testirati na Macu i na Linuxu.
///
/// Verzija oblika (`formatVersion`) nije isto što i `version` u SyncStateu: ta je verzija
/// dokumenta u oblaku (syncVersion), a ova je oblik datoteke na uređaju. Datoteka bez
/// `formatVersion` je verzija 0 (nastala prije oznake) i učitava se uz migraciju.
public enum LocalFile {
    /// Trenutni oblik datoteke. Svaka promjena oblika podiže broj i dodaje korak u `migrate`.
    public static let formatVersion = 1
    static let formatKey = "formatVersion"
    static let unreadablePrefix = "wedding-nečitljivo-"
    static let newerPrefix = "wedding-novija-verzija-"

    public enum LoadResult: Equatable {
        /// Datoteke još nema (prvo pokretanje).
        case missing
        /// Učitano. `migratedFrom` je stara verzija ako je datoteka migrirana, inače nil.
        case loaded(SyncState, migratedFrom: Int?)
        /// Datoteka se ne može pročitati; sačuvana je sa strane.
        case unreadable
        /// Datoteku je napisala novija verzija aplikacije; ne diramo je, sačuvana je sa strane.
        case tooNew(Int)
    }

    public enum Decoded: Equatable {
        case loaded(SyncState, migratedFrom: Int?)
        case unreadable
        case tooNew(Int)
    }

    // MARK: Čisto kodiranje i dekodiranje

    public static func encode(_ state: SyncState) throws -> Data {
        var json = state.toJSON()
        guard case .object(var object) = json else { throw CocoaError(.fileWriteUnknown) }
        object[formatKey] = .number(Double(formatVersion))
        json = .object(object)
        return try JSONEncoder().encode(json)
    }

    public static func decode(_ bytes: Data) -> Decoded {
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: bytes),
              let object = json.objectValue else { return .unreadable }
        let raw = object[formatKey]?.numberValue ?? 0
        guard raw.isFinite, raw >= 0, raw == raw.rounded() else { return .unreadable }
        let version = Int(raw)
        if version > formatVersion { return .tooNew(version) }
        let migrated = migrate(json, from: version)
        return .loaded(SyncState(json: migrated), migratedFrom: version < formatVersion ? version : nil)
    }

    /// Koraci migracije, jedan po verziji (v → v+1). Verzija 0 → 1 mijenja samo oznaku:
    /// oblik zapisa je isti, a polja koja aplikacija ne poznaje ostaju sačuvana.
    static func migrate(_ json: JSONValue, from version: Int) -> JSONValue {
        var current = json
        var v = version
        while v < formatVersion {
            // Nema koraka koji mijenjaju oblik; budući korak dodaje se ovdje, npr.:
            // if v == 1 { current = renameField(current) }
            v += 1
        }
        if case .object(var object) = current {
            object[formatKey] = .number(Double(formatVersion))
            current = .object(object)
        }
        return current
    }

    // MARK: Datoteka

    /// Učitava datoteku. Nečitljivu ili noviju datoteku premješta sa strane, da je prvo
    /// spremanje ne prepiše praznim stanjem.
    public static func load(from url: URL, now: Date = Date()) -> LoadResult {
        guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
        guard let bytes = try? Data(contentsOf: url) else {
            moveAside(url, prefix: unreadablePrefix, now: now)
            return .unreadable
        }
        switch decode(bytes) {
        case .loaded(let state, let from): return .loaded(state, migratedFrom: from)
        case .unreadable:
            moveAside(url, prefix: unreadablePrefix, now: now)
            return .unreadable
        case .tooNew(let v):
            moveAside(url, prefix: newerPrefix, now: now)
            return .tooNew(v)
        }
    }

    public static func save(_ state: SyncState, to url: URL) throws {
        let bytes = try encode(state)
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url, options: .atomic)
    }

    /// Briše sačuvane (sa strane) kopije uz glavnu datoteku. Koristi se pri brisanju svih podataka.
    public static func removeAside(near url: URL) {
        let dir = url.deletingLastPathComponent()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for name in names where name.hasPrefix(unreadablePrefix) || name.hasPrefix(newerPrefix) {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
        }
    }

    private static func moveAside(_ url: URL, prefix: String, now: Date) {
        let aside = url.deletingLastPathComponent()
            .appendingPathComponent("\(prefix)\(Int(now.timeIntervalSince1970)).json")
        try? FileManager.default.removeItem(at: aside)
        try? FileManager.default.moveItem(at: url, to: aside)
    }
}

extension SyncState {
    /// Stanje nakon brisanja svega: svi zapisi su obrisani (s nadgrobnim oznakama, da se brisanje
    /// prenese i na druge uređaje), a postavke su vraćene na zadane.
    public func erasedAll(now: Double) -> SyncState {
        var next = self
        for store in SyncState.stores where store != "settings" {
            next.remove(store, ids: (next.records[store] ?? []).compactMap { $0.id }, now: now)
        }
        next.put("settings", [WeddingData().settings], now: now)
        return next
    }
}
