import Foundation
import Observation
import SeatingCore

/// Stanje aplikacije: cijelo vjenčanje i nadgrobni zapisi, spremljeni kao JSON
/// datoteka na uređaju (radi i bez prijave i bez interneta). Svaka izmjena
/// stavlja `updatedAt` i briše tako da se kasnije može spojiti s oblakom
/// (faza 5), isto kao js/db.js na webu.
@MainActor
@Observable
final class WeddingStore {
    private(set) var sync = SyncState()
    private(set) var loadError: String?
    private let fileURL: URL

    nonisolated static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("wedding.json")
    }

    init(fileURL: URL = WeddingStore.defaultURL) {
        self.fileURL = fileURL
        load()
    }

    var data: WeddingData { sync.wedding }
    var guests: [Record] { sync.records["guests"] ?? [] }
    var tables: [Record] { sync.records["tables"] ?? [] }
    var categories: [Record] { sync.records["categories"] ?? [] }

    /// Gosti s popisa; mladenci i kumovi nisu gosti (kao na webu).
    var invitedGuests: [Record] { guests.filter { !$0.isTruthy("party") } }

    func tableName(_ id: String?) -> String? {
        guard let id = id else { return nil }
        return tables.first { $0.id == id }?.string("name")
    }

    func category(_ id: String?) -> Record? {
        guard let id = id else { return nil }
        return categories.first { $0.id == id }
    }

    private static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    // MARK: Učitavanje i spremanje

    private func load() {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do {
            let bytes = try Data(contentsOf: fileURL)
            sync = SyncState(json: try JSONDecoder().decode(JSONValue.self, from: bytes))
            repair()
        } catch {
            loadError = "Spremljeni podaci se ne mogu pročitati."
        }
    }

    /// Popravci nakon učitavanja, kao na webu; promijenjeni zapisi se spremaju.
    private func repair() {
        var wedding = sync.wedding
        let tableIds = Set(wedding.migrateTables())
        let guestIds = Set(wedding.repairSeating())
        if !tableIds.isEmpty {
            sync.put("tables", wedding.tables.filter { tableIds.contains($0.id ?? "") }, now: Self.now())
        }
        if !guestIds.isEmpty {
            sync.put("guests", wedding.guests.filter { guestIds.contains($0.id ?? "") }, now: Self.now())
        }
        if !tableIds.isEmpty || !guestIds.isEmpty { persist() }
    }

    /// JSON sigurnosna kopija s web aplikacije (isti oblik: settings, tables, categories, guests, rules).
    func importBackup(_ bytes: Data) throws {
        let raw = try JSONDecoder().decode(JSONValue.self, from: bytes)
        guard raw.objectValue != nil else { throw CocoaError(.fileReadCorruptFile) }
        var wedding = DataCleaning.cleanData(raw)
        wedding.migrateTables()
        wedding.repairSeating()
        sync = SyncState(wedding: wedding, now: Self.now())
        persist()
    }

    private func persist() {
        do {
            let bytes = try JSONEncoder().encode(sync.toJSON())
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try bytes.write(to: fileURL, options: .atomic)
        } catch {
            loadError = "Podaci se ne mogu spremiti."
        }
    }

    // MARK: Izmjene

    func put(_ store: String, _ items: [Record]) {
        sync.put(store, items, now: Self.now())
        persist()
    }

    func remove(_ store: String, ids: [String]) {
        sync.remove(store, ids: ids, now: Self.now())
        persist()
    }

    // MARK: Gosti

    /// Novi gost ili izmjena postojećeg (ostala polja ostaju kakva jesu, npr.
    /// uloga mladenaca). Gost koji je "možda" gubi mjesto, kao na webu.
    func saveGuest(id: String?, name: String, categoryId: String?, notes: String, locked: Bool, maybe: Bool) {
        var guest = guests.first { $0.id == id } ?? Record([
            "id": .string(UUID().uuidString.lowercased()),
            "tableId": .null,
            "seatIndex": .null
        ])
        guest["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        guest["categoryId"] = categoryId.map { .string($0) } ?? .null
        guest["notes"] = .string(notes.trimmingCharacters(in: .whitespacesAndNewlines))
        guest["locked"] = .bool(locked)
        if maybe {
            guest["tableId"] = .null
            guest["seatIndex"] = .null
            guest["status"] = .string("maybe")
        } else {
            let seated = !(guest.string("tableId") ?? "").isEmpty
            guest["status"] = .string(seated ? "assigned" : "unassigned")
        }
        put("guests", [guest])
    }

    /// Briše gosta i izbacuje ga iz pravila (grupa "zajedno" ostaje ako u njoj
    /// ima bar dvoje; pravila "odvojeno" i "fiksno mjesto" za gosta nestaju).
    func deleteGuest(_ id: String) {
        let now = Self.now()
        sync.remove("guests", ids: [id], now: now)
        var changed: [Record] = []
        var gone: [String] = []
        for rule in sync.records["rules"] ?? [] {
            guard let ruleId = rule.id,
                  let ids = rule.fields["guestIds"]?.arrayValue?.compactMap({ $0.stringValue }),
                  ids.contains(id) else { continue }
            let rest = ids.filter { $0 != id }
            if rule.string("type") == "together", rest.count >= 2 {
                var r = rule
                r["guestIds"] = .array(rest.map { .string($0) })
                changed.append(r)
            } else {
                gone.append(ruleId)
            }
        }
        if !changed.isEmpty { sync.put("rules", changed, now: now) }
        if !gone.isEmpty { sync.remove("rules", ids: gone, now: now) }
        persist()
    }
}
