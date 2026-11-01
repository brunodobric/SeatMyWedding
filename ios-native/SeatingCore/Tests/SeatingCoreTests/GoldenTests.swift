import XCTest
@testable import SeatingCore

/// Zlatni testovi: Fixtures/golden.json je napravljen pokretanjem POSTOJEĆEG
/// JavaScripta (tools/golden/generate-golden.mjs). Swift mora dati iste rezultate.
final class GoldenTests: XCTestCase {
    private struct Case: Decodable {
        let name: String
        let input: JSONValue
        let expected: JSONValue
        let now: Double?
    }

    private func load(_ section: String) throws -> [Case] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "golden", withExtension: "json", subdirectory: "Fixtures"))
        let data = try Data(contentsOf: url)
        let all = try JSONDecoder().decode([String: [Case]].self, from: data)
        return try XCTUnwrap(all[section])
    }

    private func records(_ v: JSONValue?) -> [Record] {
        (v?.arrayValue ?? []).compactMap { $0.objectValue.map { Record($0) } }
    }

    private func ids(_ v: JSONValue?) -> [String] {
        (v?.arrayValue ?? []).compactMap { $0.stringValue }
    }

    func testCleanData() throws {
        let cases = try load("cleanData")
        XCTAssertGreaterThan(cases.count, 10)
        for c in cases {
            let got = DataCleaning.cleanData(c.input).json
            XCTAssertEqual(got, c.expected, "cleanData: \(c.name)")
        }
    }

    func testMigrateTables() throws {
        let cases = try load("migrateTables")
        XCTAssertGreaterThan(cases.count, 10)
        for c in cases {
            var data = WeddingData(tables: records(c.input.objectValue?["tables"]))
            let changed = data.migrateTables()
            XCTAssertEqual(data.tables.map { $0.json }, c.expected.objectValue?["tables"]?.arrayValue, "migrateTables tablice: \(c.name)")
            XCTAssertEqual(changed, ids(c.expected.objectValue?["changed"]), "migrateTables promijenjeni: \(c.name)")
        }
    }

    func testRepairSeating() throws {
        let cases = try load("repairSeating")
        XCTAssertGreaterThan(cases.count, 10)
        for c in cases {
            var data = WeddingData(
                tables: records(c.input.objectValue?["tables"]),
                guests: records(c.input.objectValue?["guests"])
            )
            let freed = data.repairSeating()
            XCTAssertEqual(data.guests.map { $0.json }, c.expected.objectValue?["guests"]?.arrayValue, "repairSeating gosti: \(c.name)")
            XCTAssertEqual(freed, ids(c.expected.objectValue?["freed"]), "repairSeating oslobođeni: \(c.name)")
        }
    }

    /// Redoslijed zapisa u spojenom stanju nije bitan, pa se sortira po id-u.
    private func sorted(_ s: SyncState) -> JSONValue {
        var copy = s
        for store in SyncState.stores {
            copy.records[store] = (copy.records[store] ?? []).sorted { ($0.id ?? "") < ($1.id ?? "") }
        }
        return copy.toJSON()
    }

    func testMergeSyncStates() throws {
        let cases = try load("mergeSyncStates")
        XCTAssertGreaterThan(cases.count, 10)
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let a = SyncState(json: input["a"] ?? .null)
            let b = SyncState(json: input["b"] ?? .null)
            let preferB = input["preferB"]?.isTruthy ?? false
            let now = try XCTUnwrap(input["now"]?.numberValue)
            let merged = SyncState.merge(a, b, preferB: preferB, now: now)
            let expected = SyncState(json: c.expected)
            XCTAssertEqual(sorted(merged), sorted(expected), "merge: \(c.name)")
        }
    }

    private func assertClose(_ a: Double?, _ b: Double?, _ message: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let a = a, let b = b else {
            XCTAssertEqual(a, b, message, file: file, line: line)
            return
        }
        XCTAssertEqual(a, b, accuracy: 1e-9, message, file: file, line: line)
    }

    func testFloorGeometry() throws {
        let cases = try load("floorGeometry")
        XCTAssertGreaterThan(cases.count, 5)
        for c in cases {
            let tables = records(c.input.objectValue?["tables"])
            let expected = try XCTUnwrap(c.expected.objectValue)
            let dims = try XCTUnwrap(expected["dims"]?.arrayValue)
            let seats = try XCTUnwrap(expected["seats"]?.arrayValue)
            XCTAssertEqual(dims.count, tables.count, c.name)
            for (i, t) in tables.enumerated() {
                let d = FloorGeometry.dims(t)
                assertClose(d.w, dims[i].objectValue?["w"]?.numberValue, "\(c.name) dims w \(i)")
                assertClose(d.h, dims[i].objectValue?["h"]?.numberValue, "\(c.name) dims h \(i)")
                let got = FloorGeometry.seatPositions(t)
                let want = seats[i].arrayValue ?? []
                XCTAssertEqual(got.count, want.count, "\(c.name) broj mjesta \(i)")
                for (k, p) in zip(got, want) {
                    assertClose(k.x, p.objectValue?["x"]?.numberValue, "\(c.name) x \(i)")
                    assertClose(k.y, p.objectValue?["y"]?.numberValue, "\(c.name) y \(i)")
                }
            }
            let bounds = FloorGeometry.contentBounds(tables)
            if case .object(let b)? = expected["bounds"] {
                assertClose(bounds?.x1, b["x1"]?.numberValue, "\(c.name) x1")
                assertClose(bounds?.y1, b["y1"]?.numberValue, "\(c.name) y1")
                assertClose(bounds?.x2, b["x2"]?.numberValue, "\(c.name) x2")
                assertClose(bounds?.y2, b["y2"]?.numberValue, "\(c.name) y2")
            } else {
                XCTAssertNil(bounds, "\(c.name) okvir")
            }
        }
    }

    func testDropGuest() throws {
        let cases = try load("dropGuest")
        XCTAssertGreaterThan(cases.count, 50)
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            var data = WeddingData(tables: records(input["tables"]), guests: records(input["guests"]))
            let guestId = try XCTUnwrap(input["guestId"]?.stringValue)
            let t = try XCTUnwrap(input["target"]?.objectValue)
            let target: DropTarget
            switch t["kind"]?.stringValue {
            case "seat":
                target = .seat(tableId: t["tableId"]?.stringValue ?? "", seatIndex: Int(t["seatIndex"]?.numberValue ?? 0))
            case "table":
                target = .table(tableId: t["tableId"]?.stringValue ?? "")
            default:
                target = .unseat
            }
            let result = data.dropGuest(guestId, onto: target)
            data.place(result.moves)

            let expected = try XCTUnwrap(c.expected.objectValue)
            XCTAssertEqual(data.guests.map { $0.json }, expected["guests"]?.arrayValue, "dropGuest gosti: \(c.name)")
            let notices = (expected["notices"]?.arrayValue ?? []).compactMap { $0.objectValue }
            XCTAssertEqual(notices.count, result.notice == nil ? 0 : 1, "dropGuest poruke: \(c.name)")
            if let n = result.notice, let want = notices.first {
                XCTAssertEqual(n.message, want["message"]?.stringValue, "dropGuest poruka: \(c.name)")
                XCTAssertEqual(n.isError, want["isError"]?.isTruthy ?? false, "dropGuest greška: \(c.name)")
            }
            XCTAssertEqual(result.undoMessage, expected["undoMessage"]?.stringValue, "dropGuest poništi: \(c.name)")
        }
    }

    func testSuggestSeating() throws {
        let cases = try load("suggestSeating")
        XCTAssertGreaterThan(cases.count, 50)
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let data = WeddingData(
                tables: records(input["tables"]), categories: records(input["categories"]),
                guests: records(input["guests"]), rules: records(input["rules"])
            )
            let got = data.suggestSeating()
            let gotAssignments: [JSONValue] = got.assignments.map {
                .object([
                    "guestId": .string($0.id),
                    "tableId": $0.tableId.map { .string($0) } ?? .null,
                    "seatIndex": $0.seatIndex.map { .number($0) } ?? .null
                ])
            }
            let expected = try XCTUnwrap(c.expected.objectValue)
            XCTAssertEqual(gotAssignments, expected["assignments"]?.arrayValue, "suggestSeating raspored: \(c.name)")
            let gotViolations: [JSONValue] = got.violations.map {
                .object(["ruleId": $0.ruleId.map { .string($0) } ?? .null, "reason": .string($0.reason)])
            }
            XCTAssertEqual(gotViolations, expected["violations"]?.arrayValue, "suggestSeating prekršaji: \(c.name)")
        }
    }

    private func ruleWorld(_ input: [String: JSONValue]) -> WeddingData {
        WeddingData(
            tables: records(input["tables"]), categories: records(input["categories"]),
            guests: records(input["guests"]), rules: records(input["rules"])
        )
    }

    private func counter() -> IDMaker {
        var n = 0
        return { n += 1; return "u-\(n)" }
    }

    private func stripped(_ rules: [Record]) -> [JSONValue] {
        rules.map { r in var c = r; c["satisfied"] = nil; return c.json }
    }

    func testNormalizeRules() throws {
        let cases = try load("normalizeRules")
        XCTAssertGreaterThan(cases.count, 50)
        for c in cases {
            let data = ruleWorld(try XCTUnwrap(c.input.objectValue))
            let got = data.normalizeRules(data.rules, makeID: counter()).map { $0.json }
            XCTAssertEqual(got, c.expected.arrayValue, "normalizeRules: \(c.name)")
        }
    }

    func testRuleStatus() throws {
        let cases = try load("ruleStatus")
        for c in cases {
            let data = ruleWorld(try XCTUnwrap(c.input.objectValue))
            let got: [JSONValue] = data.rules.map { r in data.isSatisfied(r).map { .bool($0) } ?? .null }
            XCTAssertEqual(got, c.expected.arrayValue, "isSatisfied: \(c.name)")
        }
    }

    func testSetRelations() throws {
        let cases = try load("setRelations")
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let data = ruleWorld(input)
            let rel = try XCTUnwrap(input["rel"]?.objectValue)
            let got = data.rulesAfterSettingRelations(
                guestId: input["guestId"]?.stringValue ?? "",
                together: ids(rel["together"]), apart: ids(rel["apart"]),
                fixedTableId: rel["fixedTableId"]?.stringValue, fixedSeat: rel["fixedSeat"]?.numberValue,
                makeID: counter()
            )
            XCTAssertEqual(stripped(got), c.expected.arrayValue, "setGuestRelations: \(c.name)")
        }
    }

    func testCategoryAndGroupRules() throws {
        let cases = try load("categoryRules")
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let data = ruleWorld(input)
            let expected = try XCTUnwrap(c.expected.objectValue)
            let cat = data.rulesAfterSettingCategoryTogether(
                input["categoryId"]?.stringValue ?? "", on: input["on"]?.isTruthy ?? false, makeID: counter())
            XCTAssertEqual(stripped(cat), expected["category"]?.arrayValue, "setCategoryTogether: \(c.name)")
            let groups = (input["groups"]?.arrayValue ?? []).map { ids($0) }
            let added = data.rulesAfterAddingTogether(groups, makeID: counter())
            XCTAssertEqual(stripped(added), expected["groups"]?.arrayValue, "addTogetherGroups: \(c.name)")
        }
    }

    func testPlanHall() throws {
        let cases = try load("planHall")
        XCTAssertGreaterThan(cases.count, 50)
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let data = ruleWorld(input)
            let form = try XCTUnwrap(input["form"]?.objectValue)
            let plan = data.planHall(
                template: HallTemplate(rawValue: form["template"]?.stringValue ?? "") ?? .round,
                guestCount: Int(form["guestCount"]?.numberValue ?? 0),
                perTable: Int(form["perTable"]?.numberValue ?? 0),
                mode: HallMode(rawValue: form["mode"]?.stringValue ?? "") ?? .add,
                makeID: counter()
            )
            let expected = try XCTUnwrap(c.expected.objectValue)
            XCTAssertEqual(plan.create.map { $0.json }, expected["create"]?.arrayValue, "planHall stolovi: \(c.name)")
            XCTAssertEqual(plan.remove, ids(expected["remove"]), "planHall uklonjeni: \(c.name)")
            XCTAssertEqual(Double(plan.count), expected["count"]?.numberValue, "planHall broj: \(c.name)")
            XCTAssertEqual(Double(plan.perTable), expected["perTable"]?.numberValue, "planHall po stolu: \(c.name)")
        }
    }

    func testPlaceNewTable() throws {
        let cases = try load("placeTable")
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let data = ruleWorld(input)
            let table = Record(try XCTUnwrap(input["table"]?.objectValue))
            XCTAssertEqual(data.placeNewTable(table, makeID: counter()).json, c.expected, "placeNewTable: \(c.name)")
        }
    }

    func testReseatOverflow() throws {
        let cases = try load("reseat")
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            var data = WeddingData(
                tables: [Record(try XCTUnwrap(input["table"]?.objectValue))],
                guests: records(input["guests"]))
            let moved = data.reseatOverflowGuests(table: data.tables[0])
            for g in moved { if let i = data.guests.firstIndex(where: { $0.id == g.id }) { data.guests[i] = g } }
            let expected = try XCTUnwrap(c.expected.objectValue)
            XCTAssertEqual(moved.compactMap { $0.id }, ids(expected["moved"]), "reseat promijenjeni: \(c.name)")
            XCTAssertEqual(data.guests.map { $0.json }, expected["guests"]?.arrayValue, "reseat gosti: \(c.name)")
        }
    }

    private func importRowsJSON(_ rows: [ImportRow]) -> [JSONValue] {
        rows.map { .object(["names": .array($0.names.map { .string($0) }), "category": $0.category.map { .string($0) } ?? .null]) }
    }

    private func previewJSON(_ p: ImportPreview) -> JSONValue {
        .object([
            "rows": .array(importRowsJSON(p.rows)), "guests": .number(Double(p.guests)),
            "groups": .number(Double(p.groups)), "skipped": .number(Double(p.skipped)),
            "duplicates": .array(p.duplicates.map { .string($0) })
        ])
    }

    func testGuestImport() throws {
        let cases = try load("guestImport")
        XCTAssertGreaterThan(cases.count, 50)
        for c in cases {
            let input = try XCTUnwrap(c.input.objectValue)
            let text = input["text"]?.stringValue ?? ""
            let existing = ids(input["existing"])
            let expected = try XCTUnwrap(c.expected.objectValue)
            let sf = GuestImport.detectSurnameFirst(text)
            XCTAssertEqual(sf, expected["surnameFirst"]?.isTruthy, "detectSurnameFirst: \(c.name)")
            let rows = GuestImport.parse(text, surnameFirst: sf)
            XCTAssertEqual(importRowsJSON(rows), expected["rows"]?.arrayValue, "parse: \(c.name)")
            XCTAssertEqual(importRowsJSON(GuestImport.parse(text, surnameFirst: true)), expected["rowsSF"]?.arrayValue, "parse prezime prvo: \(c.name)")
            XCTAssertEqual(previewJSON(GuestImport.preview(rows, existingNames: existing)), expected["preview"], "preview: \(c.name)")
            XCTAssertEqual(previewJSON(GuestImport.preview(rows, existingNames: existing, includeExisting: true)), expected["previewAll"], "preview svi: \(c.name)")
        }
    }

    func testCloudDoc() throws {
        let cases = try load("cloudDoc")
        for c in cases {
            let now = try XCTUnwrap(c.now)
            let fromCloud = SyncState.fromCloudDoc(c.input == .null ? nil : c.input)
            let expectedFrom = try XCTUnwrap(c.expected.objectValue?["fromCloud"])
            XCTAssertEqual(fromCloud.toJSON(), SyncState(json: expectedFrom).toJSON(), "fromCloudDoc: \(c.name)")
            // toCloudDoc se računa iz stanja koje je napravio JavaScript.
            let toCloud = SyncState(json: expectedFrom).toCloudDoc(now: now)
            XCTAssertEqual(toCloud, c.expected.objectValue?["toCloud"], "toCloudDoc: \(c.name)")
        }
    }
}

final class BasicsTests: XCTestCase {
    func testSafeID() {
        XCTAssertTrue(DataCleaning.isSafeID("abc-DEF_123"))
        XCTAssertFalse(DataCleaning.isSafeID(""))
        XCTAssertFalse(DataCleaning.isSafeID("a b"))
        XCTAssertFalse(DataCleaning.isSafeID("č"))
        XCTAssertFalse(DataCleaning.isSafeID(String(repeating: "x", count: 65)))
        XCTAssertTrue(DataCleaning.isSafeID(String(repeating: "x", count: 64)))
    }

    func testUnknownFieldsSurvive() throws {
        let json = #"{"id":"g1","name":"Ana","novoPolje":{"a":[1,null,"x"]}}"#
        let raw = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        let rec = try XCTUnwrap(DataCleaning.cleanRecord(raw))
        XCTAssertEqual(rec["novoPolje"], .object(["a": .array([.number(1), .null, .string("x")])]))
    }
}
