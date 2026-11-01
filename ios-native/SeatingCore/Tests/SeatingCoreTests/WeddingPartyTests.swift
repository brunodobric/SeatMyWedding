import XCTest
@testable import SeatingCore

final class WeddingPartyTests: XCTestCase {
    private func counter() -> IDMaker {
        var n = 0
        return { n += 1; return "id-\(n)" }
    }

    func testCreatesHeadTableAndSeatsPartyInOrder() throws {
        var data = WeddingData()
        data.saveWeddingParty(names: ["", "Kuma K", "Ana", "Ivo", "Kum K", ""], makeID: counter())
        let head = try XCTUnwrap(data.headTable)
        XCTAssertEqual(head.number("seats"), 4)
        XCTAssertEqual(head.number("seatsLong"), 4)
        let seated = data.guests.sorted { ($0.number("seatIndex") ?? 0) < ($1.number("seatIndex") ?? 0) }
        XCTAssertEqual(seated.map { $0.string("name") }, ["Kuma K", "Ana", "Ivo", "Kum K"])
        XCTAssertTrue(seated.allSatisfy { $0.isTruthy("locked") && $0.isTruthy("party") && $0.string("tableId") == head.id })
        XCTAssertEqual(seated.map { WeddingParty.role($0) }, ["Kuma", "Mladenka", "Mladoženja", "Kum"])
        XCTAssertTrue(data.invitedGuests.isEmpty)
    }

    func testRemovingAPersonShrinksTheTable() throws {
        var data = WeddingData()
        let make = counter()
        data.saveWeddingParty(names: ["", "Kuma", "Ana", "Ivo", "Kum", ""], makeID: make)
        data.saveWeddingParty(names: ["", "", "Ana", "Ivo", "Kum", ""], makeID: make)
        XCTAssertEqual(data.headTable?.number("seats"), 3)
        XCTAssertEqual(data.guests.count, 3)
        XCTAssertEqual(data.guests.compactMap { $0.integer("seatIndex") }.sorted(), [0, 1, 2])
    }

    func testExistingGuestBecomesPartyAndRenameKeepsId() throws {
        var data = WeddingData(guests: [Record([
            "id": .string("g1"), "name": .string("Ana"), "status": .string("unassigned"),
            "tableId": .null, "seatIndex": .null
        ])])
        data.saveWeddingParty(names: ["", "", "ana", "", "", ""], makeID: counter())
        XCTAssertEqual(data.guests.count, 1)
        XCTAssertEqual(data.guests[0].id, "g1")
        XCTAssertEqual(data.guests[0].string("partySlot"), "bride")
        data.saveWeddingParty(names: ["", "", "Ana Horvat", "", "", ""], makeID: counter())
        XCTAssertEqual(data.guests.count, 1)
        XCTAssertEqual(data.guests[0].string("name"), "Ana Horvat")
    }

    func testAddingToExistingTableGrowsIt() throws {
        var data = WeddingData()
        let make = counter()
        data.saveWeddingParty(names: ["", "", "Ana", "Ivo", "", ""], makeID: make)
        data.saveWeddingParty(names: ["", "Kuma", "Ana", "Ivo", "Kum", ""], makeID: make)
        XCTAssertEqual(data.headTable?.number("seats"), 4)
        let kuma = data.guests.first { $0.string("name") == "Kuma" }
        XCTAssertEqual(kuma?.number("seatIndex"), 0)
    }
}
