import Foundation
import Observation
import SeatingCore

/// Stanje aplikacije: cijelo vjenčanje, spremljeno kao JSON datoteka na uređaju
/// (radi i bez prijave i bez interneta). Sinkronizacija s oblakom dolazi u fazi 5.
@MainActor
@Observable
final class WeddingStore {
    private(set) var data = WeddingData()
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

    var guests: [Record] { data.guests }
    var tables: [Record] { data.tables }

    func tableName(_ id: String?) -> String? {
        guard let id = id else { return nil }
        return data.tables.first { $0.id == id }?.string("name")
    }

    private func load() {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do {
            let bytes = try Data(contentsOf: fileURL)
            apply(try JSONDecoder().decode(JSONValue.self, from: bytes))
        } catch {
            loadError = "Spremljeni podaci se ne mogu pročitati."
        }
    }

    /// Čisti podatke i popravlja ih kao web pri učitavanju.
    private func apply(_ raw: JSONValue) {
        var cleaned = DataCleaning.cleanData(raw)
        cleaned.migrateTables()
        cleaned.repairSeating()
        data = cleaned
    }

    /// JSON sigurnosna kopija s web aplikacije (isti oblik: settings, tables, categories, guests, rules).
    func importBackup(_ bytes: Data) throws {
        let raw = try JSONDecoder().decode(JSONValue.self, from: bytes)
        guard raw.objectValue != nil else { throw CocoaError(.fileReadCorruptFile) }
        apply(raw)
        try save()
    }

    func save() throws {
        let bytes = try JSONEncoder().encode(data.json)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: fileURL, options: .atomic)
    }
}
