import XCTest
@testable import SeatingCore

final class ExportTests: XCTestCase {
    private func world() -> WeddingData {
        func g(_ id: String, _ name: String, table: String? = nil, seat: Double? = nil, status: String = "unassigned",
               party: String? = nil, slot: String? = nil, notes: String = "") -> Record {
            var f: [String: JSONValue] = [
                "id": .string(id), "name": .string(name), "status": .string(status), "notes": .string(notes),
                "tableId": table.map { .string($0) } ?? .null, "seatIndex": seat.map { .number($0) } ?? .null
            ]
            if let party { f["party"] = .string(party) }
            if let slot { f["partySlot"] = .string(slot) }
            return Record(f)
        }
        return WeddingData(
            settings: Record(["id": .string("main"), "weddingTitle": .string("Ana i Ivo")]),
            tables: [Record(["id": .string("t1"), "name": .string("Stol 1")]), Record(["id": .string("t2"), "name": .string("Stol 2")])],
            categories: [Record(["id": .string("c1"), "name": .string("Obitelj")])],
            guests: [
                g("g1", "Šime Babić", table: "t2", seat: 0, status: "assigned"),
                g("g2", "Ana Horvat", table: "t1", seat: 1, status: "assigned", party: "couple", slot: "bride"),
                g("g3", "=SUM(A1)", status: "maybe", notes: "ima \"navodnike\""),
                g("g4", "Marko Kovač", table: "t1", seat: 0, status: "assigned")
            ]
        )
    }

    func testCSVHasBOMHeaderRolesAndFormulaGuard() {
        let csv = world().csv()
        XCTAssertTrue(csv.hasPrefix("\u{FEFF}\"Ime\",\"Uloga\""))
        let lines = csv.dropFirst().components(separatedBy: "\r\n")
        XCTAssertEqual(lines.count, 5)
        XCTAssertTrue(csv.contains("\"'=SUM(A1)\""))
        XCTAssertTrue(csv.contains("\"Ana Horvat\",\"Mladenka\",\"\",\"Stol 1\",\"2\",\"Dodijeljen\""))
        XCTAssertTrue(csv.contains("ima \"\"navodnike\"\""))
    }

    func testShareTextAndPrintLists() {
        let data = world()
        XCTAssertEqual(data.seatingListLines(), ["Ana Horvat (Mladenka) – Stol 1", "Marko Kovač – Stol 1", "Šime Babić – Stol 2"])
        XCTAssertEqual(data.seatingShareText()?.hasPrefix("Ana i Ivo – gdje sjedim\n\n"), true)
        XCTAssertEqual(data.printTables().map { $0.guests }, [["Marko Kovač", "Ana Horvat · Mladenka"], ["Šime Babić"]])
        XCTAssertEqual(data.printAlphabetical().first, PrintRow(name: "Ana Horvat · Mladenka", table: "Stol 1"))
        XCTAssertNil(WeddingData().seatingShareText())
    }

    func testBackupJSONRoundTrips() throws {
        let data = world()
        let text = data.backupJSONString()
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        XCTAssertEqual(value, data.json)
    }
}
