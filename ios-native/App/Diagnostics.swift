import Foundation
import MetricKit
import Observation

/// Prijava rušenja bez ikakvog vanjskog servisa: iOS sam (MetricKit) dostavi izvještaj o rušenju
/// pri sljedećem pokretanju, najčešće idući dan. Izvještaji se spremaju samo na uređaju, ne
/// sadrže goste ni stolove (samo tragove poziva), a šalju se tek kad ih korisnik sam podijeli
/// iz Postavki.
@MainActor
@Observable
final class Diagnostics: NSObject, MXMetricManagerSubscriber {
    private(set) var reports: [URL] = []
    private let directory: URL
    private static let keep = 10

    init(directory: URL = Diagnostics.defaultDirectory) {
        self.directory = directory
        super.init()
        refresh()
    }

    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("dijagnostika", isDirectory: true)
    }

    func start() {
        MXMetricManager.shared.add(self)
    }

    /// iOS dostavlja izvještaje o rušenjima, zamrzavanju i sličnom.
    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let items = payloads.map { $0.jsonRepresentation() }
        Task { @MainActor in
            for data in items { save(data) }
        }
    }

    func refresh() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        reports = names.filter { $0.hasPrefix("dijagnostika-") }.sorted(by: >).map { directory.appendingPathComponent($0) }
    }

    func save(_ data: Data) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let stamp = ISO8601DateFormatter().string(from: .now).replacingOccurrences(of: ":", with: "-")
            try data.write(to: directory.appendingPathComponent("dijagnostika-\(stamp)-\(UUID().uuidString.prefix(4)).json"),
                           options: .atomic)
        } catch {
            return
        }
        refresh()
        for old in reports.dropFirst(Self.keep) { try? FileManager.default.removeItem(at: old) }
        refresh()
    }

    func deleteAll() {
        for url in reports { try? FileManager.default.removeItem(at: url) }
        refresh()
    }
}
