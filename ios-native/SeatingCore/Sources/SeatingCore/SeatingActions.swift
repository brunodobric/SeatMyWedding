import Foundation

/// Kamo se gost spušta: na točno mjesto, na stol (prvo slobodno mjesto) ili
/// "bez mjesta". Port dropGuest / placeGuests / firstFreeSeat iz js/guest-drag.js,
/// js/state.js i js/app.js.
public enum DropTarget: Equatable, Sendable {
    case seat(tableId: String, seatIndex: Int)
    case table(tableId: String)
    case unseat
}

/// Jedna promjena mjesta. `tableId == nil` znači "bez mjesta".
public struct SeatMove: Equatable, Sendable {
    public var id: String
    public var tableId: String?
    public var seatIndex: Double?
    public init(id: String, tableId: String?, seatIndex: Double?) {
        self.id = id; self.tableId = tableId; self.seatIndex = seatIndex
    }
}

public struct Notice: Equatable, Sendable {
    public var message: String
    public var isError: Bool
    public init(_ message: String, isError: Bool = false) {
        self.message = message; self.isError = isError
    }
}

public struct DropResult: Equatable, Sendable {
    /// Promjene koje treba primijeniti (prazno ako se ništa ne događa).
    public var moves: [SeatMove] = []
    /// Poruka korisniku (greška ili obavijest), ako je ima.
    public var notice: Notice?
    /// Poruka uz gumb "Poništi", ako se promjena može poništiti.
    public var undoMessage: String?
    public init() {}
}

extension WeddingData {
    /// Prvo slobodno mjesto za stolom ili nil ako je pun.
    public func firstFreeSeat(tableId: String) -> Int? {
        guard let table = tables.first(where: { $0.id == tableId }) else { return nil }
        var taken = Set<Double>()
        for g in guests where g.string("tableId") == tableId {
            if let s = g.integer("seatIndex") { taken.insert(s) }
        }
        for i in 0..<FloorGeometry.count(table.number("seats")) where !taken.contains(Double(i)) {
            return i
        }
        return nil
    }

    /// Izračunava što se događa kad se gost spusti na cilj; ništa ne mijenja.
    public func dropGuest(_ guestId: String, onto target: DropTarget) -> DropResult {
        var result = DropResult()
        guard let guest = guests.first(where: { $0.id == guestId }) else { return result }
        let name = guest.string("name") ?? ""

        // Mladenci i kumovi sjede samo za stolom mladenaca.
        if guest.isTruthy("party") {
            var targetTableId: String?
            switch target {
            case .seat(let t, _): targetTableId = t
            case .table(let t): targetTableId = t
            case .unseat: targetTableId = nil
            }
            let table = targetTableId.flatMap { id in tables.first { $0.id == id } }
            if table?.string("shape") != "head" {
                result.notice = Notice("\(name) sjedi za stolom mladenaca", isError: true)
                return result
            }
        }

        let currentTable = guest.string("tableId").flatMap { $0.isEmpty ? nil : $0 }

        switch target {
        case .unseat:
            if currentTable != nil {
                result.moves = [SeatMove(id: guestId, tableId: nil, seatIndex: nil)]
            }

        case .table(let tableId):
            guard let table = tables.first(where: { $0.id == tableId }) else { return result }
            if currentTable == tableId { return result }
            guard let seat = firstFreeSeat(tableId: tableId) else {
                result.notice = Notice("\(table.string("name") ?? "") nema slobodnih mjesta", isError: true)
                return result
            }
            result.moves = [SeatMove(id: guestId, tableId: tableId, seatIndex: Double(seat))]

        case .seat(let tableId, let seatIndex):
            guard tables.contains(where: { $0.id == tableId }) else { return result }
            let occupant = guests.first {
                $0.string("tableId") == tableId && $0.integer("seatIndex") == Double(seatIndex)
            }
            if let o = occupant, o.id == guestId { return result }
            if let o = occupant, o.isTruthy("locked") {
                result.notice = Notice("\(o.string("name") ?? "") ima zaključano mjesto", isError: true)
                return result
            }
            var moves = [SeatMove(id: guestId, tableId: tableId, seatIndex: Double(seatIndex))]
            if let o = occupant, let oid = o.id {
                moves.append(SeatMove(id: oid, tableId: currentTable, seatIndex: guest.number("seatIndex")))
                let oname = o.string("name") ?? ""
                result.undoMessage = currentTable != nil
                    ? "\(name) i \(oname) su zamijenili mjesta"
                    : "\(oname) je sada bez mjesta"
            }
            result.moves = moves
        }
        return result
    }

    /// Primjenjuje promjene mjesta (kao placeGuests). Vraća id-jeve promijenjenih gostiju.
    @discardableResult
    public mutating func place(_ moves: [SeatMove]) -> [String] {
        var changed: [String] = []
        for m in moves {
            guard let i = guests.firstIndex(where: { $0.id == m.id }) else { continue }
            let table = (m.tableId ?? "").isEmpty ? nil : m.tableId
            guests[i]["tableId"] = table.map { .string($0) } ?? .null
            guests[i]["seatIndex"] = table != nil ? (m.seatIndex.map { .number($0) } ?? .null) : .null
            guests[i]["status"] = .string(table != nil ? "assigned" : "unassigned")
            changed.append(m.id)
        }
        return changed
    }
}
