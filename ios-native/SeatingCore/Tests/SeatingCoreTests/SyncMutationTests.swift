import XCTest
@testable import SeatingCore

final class SyncMutationTests: XCTestCase {
    private func guest(_ id: String, _ name: String) -> Record {
        Record(["id": .string(id), "name": .string(name)])
    }

    func testPutStampsAndReplaces() {
        var s = SyncState()
        s.put("guests", [guest("g1", "Ana")], now: 100)
        s.put("guests", [guest("g1", "Ana Horvat"), guest("g2", "Ivo")], now: 200)
        XCTAssertEqual(s.records["guests"]?.count, 2)
        XCTAssertEqual(s.records["guests"]?.first?.string("name"), "Ana Horvat")
        XCTAssertEqual(s.records["guests"]?.first?.number("updatedAt"), 200)
    }

    func testRemoveLeavesTombstoneAndPutRevives() {
        var s = SyncState()
        s.put("guests", [guest("g1", "Ana")], now: 100)
        s.remove("guests", ids: ["g1"], now: 200)
        XCTAssertEqual(s.records["guests"]?.count, 0)
        XCTAssertEqual(s.deleted["guests"]?["g1"], 200)
        s.put("guests", [guest("g1", "Ana")], now: 300)
        XCTAssertEqual(s.records["guests"]?.count, 1)
        XCTAssertNil(s.deleted["guests"]?["g1"])
    }

    func testDeleteOnOneDeviceWinsOverOlderEditOnAnother() {
        var a = SyncState()
        a.put("guests", [guest("g1", "Ana")], now: 100)
        var b = a
        a.remove("guests", ids: ["g1"], now: 300)
        b.put("guests", [guest("g1", "Ana H.")], now: 200)
        let merged = SyncState.merge(a, b, preferB: true, now: 1000)
        XCTAssertEqual(merged.records["guests"]?.count, 0)
        XCTAssertEqual(merged.deleted["guests"]?["g1"], 300)
    }

    func testWeddingViewAndRoundTrip() {
        var s = SyncState()
        s.put("settings", [Record(["id": .string("main"), "weddingTitle": .string("A i I"), "monogram": .string("AI")])], now: 1)
        s.put("tables", [Record(["id": .string("t1"), "name": .string("Stol 1"), "seats": .number(8)])], now: 1)
        XCTAssertEqual(s.wedding.settings.string("weddingTitle"), "A i I")
        XCTAssertEqual(s.wedding.tables.count, 1)
        let again = SyncState(json: s.toJSON())
        XCTAssertEqual(again, s)
    }
}
