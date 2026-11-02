import XCTest
@testable import SeatingCore

final class LocalFileTests: XCTestCase {
    private var dir: URL!
    private var file: URL { dir.appendingPathComponent("wedding.json") }

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("localfile-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func guest(_ id: String, _ name: String) -> Record {
        Record(["id": .string(id), "name": .string(name)])
    }

    private func sampleState() -> SyncState {
        var s = SyncState()
        s.put("guests", [guest("g1", "Ana"), guest("g2", "Ivo")], now: 100)
        s.put("tables", [Record(["id": .string("t1"), "name": .string("Stol 1")])], now: 100)
        s.remove("guests", ids: ["g2"], now: 200)
        return s
    }

    private func asideFiles(prefix: String) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasPrefix(prefix) }
    }

    // MARK: Verzija oblika

    func testSavedFileCarriesFormatVersion() throws {
        try LocalFile.save(sampleState(), to: file)
        let json = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: file))
        XCTAssertEqual(json.objectValue?["formatVersion"]?.numberValue, Double(LocalFile.formatVersion))
    }

    func testRoundTripKeepsRecordsAndTombstones() throws {
        let state = sampleState()
        try LocalFile.save(state, to: file)
        guard case .loaded(let loaded, let from) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        XCTAssertNil(from, "datoteka u trenutnom obliku se ne migrira")
        XCTAssertEqual(loaded.records, state.records)
        XCTAssertEqual(loaded.deleted, state.deleted)
    }

    func testMissingFile() {
        XCTAssertEqual(LocalFile.load(from: file), .missing)
    }

    // MARK: Migracija

    private let legacyJSON = """
    {"records":{"guests":[{"id":"g1","name":"Ana","buduceNepoznatoPolje":{"a":[1,2]}}],
    "tables":[],"categories":[],"rules":[],"settings":[{"id":"main","weddingTitle":"Ana i Ivo"}]},
    "deleted":{"guests":{"g9":123}},"version":2,"updatedAt":5}
    """

    func testLegacyFileWithoutVersionIsMigrated() throws {
        try Data(legacyJSON.utf8).write(to: file)
        guard case .loaded(let state, let from) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        XCTAssertEqual(from, 0)
        XCTAssertEqual(state.records["guests"]?.first?.string("name"), "Ana")
        XCTAssertEqual(state.records["settings"]?.first?.string("weddingTitle"), "Ana i Ivo")
        XCTAssertEqual(state.deleted["guests"]?["g9"], 123)
        XCTAssertEqual(state.version, 2)
        XCTAssertEqual(state.updatedAt, 5)
    }

    func testMigrationKeepsUnknownFields() throws {
        try Data(legacyJSON.utf8).write(to: file)
        guard case .loaded(let state, _) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        XCTAssertEqual(state.records["guests"]?.first?["buduceNepoznatoPolje"],
                       .object(["a": .array([.number(1), .number(2)])]))
    }

    func testMigratedFileIsStampedWhenSavedAgain() throws {
        try Data(legacyJSON.utf8).write(to: file)
        guard case .loaded(let state, _) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        try LocalFile.save(state, to: file)
        guard case .loaded(_, let from) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        XCTAssertNil(from, "nakon spremanja datoteka je u trenutnom obliku")
    }

    func testDecodeOfCurrentFormatDoesNotMigrate() throws {
        let bytes = try LocalFile.encode(sampleState())
        guard case .loaded(_, let from) = LocalFile.decode(bytes) else { return XCTFail("očekivano učitavanje") }
        XCTAssertNil(from)
    }

    // MARK: Oštećeni i noviji podaci

    func testUnreadableFileIsMovedAsideNotOverwritten() throws {
        try Data("ovo nije json".utf8).write(to: file)
        XCTAssertEqual(LocalFile.load(from: file, now: Date(timeIntervalSince1970: 42)), .unreadable)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        let aside = asideFiles(prefix: "wedding-nečitljivo-")
        XCTAssertEqual(aside, ["wedding-nečitljivo-42.json"])
        XCTAssertEqual(try String(contentsOf: dir.appendingPathComponent(aside[0]), encoding: .utf8), "ovo nije json")
    }

    func testJsonThatIsNotAnObjectIsUnreadable() throws {
        try Data("[1,2,3]".utf8).write(to: file)
        XCTAssertEqual(LocalFile.load(from: file), .unreadable)
    }

    func testInvalidFormatVersionIsUnreadable() throws {
        for bad in ["-1", "1.5", "\"jedan\""] {
            try Data("{\"formatVersion\":\(bad),\"records\":{}}".utf8).write(to: file)
            let result = LocalFile.load(from: file)
            if bad == "\"jedan\"" {
                // Tekst umjesto broja tretira se kao nedostajuća oznaka (verzija 0), podaci se učitavaju.
                guard case .loaded = result else { return XCTFail("očekivano učitavanje za \(bad)") }
            } else {
                XCTAssertEqual(result, .unreadable, bad)
            }
            try? FileManager.default.removeItem(at: file)
        }
    }

    func testNewerFileStaysInPlaceUntouched() throws {
        let newer = "{\"formatVersion\":99,\"records\":{\"guests\":[{\"id\":\"g1\",\"name\":\"Ana\"}]}}"
        try Data(newer.utf8).write(to: file)
        XCTAssertEqual(LocalFile.load(from: file), .tooNew(99))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), newer,
                       "novija datoteka ostaje na mjestu i netaknuta, da je ažurirana aplikacija može učitati")
        XCTAssertEqual(asideFiles(prefix: "wedding"), ["wedding.json"])
    }

    // MARK: Brisanje svega

    func testErasedAllRemovesEveryRecordWithTombstones() {
        let erased = sampleState().erasedAll(now: 500)
        for store in ["guests", "tables", "categories", "rules"] {
            XCTAssertEqual(erased.records[store]?.count, 0, store)
        }
        XCTAssertEqual(erased.deleted["guests"]?["g1"], 500)
        XCTAssertEqual(erased.deleted["tables"]?["t1"], 500)
        XCTAssertEqual(erased.deleted["guests"]?["g2"], 200, "stara nadgrobna oznaka ostaje")
        XCTAssertEqual(erased.records["settings"]?.first?.string("weddingTitle"), "")
        XCTAssertNil(erased.records["settings"]?.first?["onboardingDone"])
    }

    func testErasedAllWinsOverOlderCopyOnAnotherDevice() {
        let before = sampleState()
        let erased = before.erasedAll(now: 500)
        let merged = SyncState.merge(erased, before, preferB: false, now: 1000)
        XCTAssertEqual(merged.records["guests"]?.count, 0)
        XCTAssertEqual(merged.records["tables"]?.count, 0)
    }

    func testRemoveAsideDeletesOnlyKeptCopies() throws {
        try Data("x".utf8).write(to: dir.appendingPathComponent("wedding-nečitljivo-1.json"))
        try LocalFile.save(sampleState(), to: file)
        LocalFile.removeAside(near: file)
        XCTAssertEqual(asideFiles(prefix: "wedding"), ["wedding.json"])
    }

    func testErasedStateRoundTripsThroughFile() throws {
        try LocalFile.save(sampleState().erasedAll(now: 500), to: file)
        guard case .loaded(let state, _) = LocalFile.load(from: file) else { return XCTFail("očekivano učitavanje") }
        XCTAssertEqual(state.records["guests"]?.count, 0)
        XCTAssertEqual(state.deleted["guests"]?["g1"], 500)
    }
}
