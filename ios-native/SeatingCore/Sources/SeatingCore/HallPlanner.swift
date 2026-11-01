import Foundation

/// Predlošci sale. Port js/hall.js ("Složi salu", novi stol na slobodno mjesto).
public enum HallTemplate: String, CaseIterable, Sendable {
    case round, long, u

    public var name: String {
        switch self {
        case .round: return "Okrugli stolovi"
        case .long: return "Dugi stolovi"
        case .u: return "U-oblik"
        }
    }
    public var hint: String {
        switch self {
        case .round: return "Klasični okrugli stolovi u redovima"
        case .long: return "Dugi stolovi u redovima, gosti s obje strane"
        case .u: return "Mladenci na čelu, gosti uz dva duga kraka"
        }
    }
    public var defaultSeats: Int {
        switch self {
        case .round: return 8
        case .long, .u: return 12
        }
    }
}

public enum HallMode: String, Sendable { case rebuild, add }

public struct HallPlan: Equatable, Sendable {
    public var create: [Record]
    public var remove: [String]
    public var count: Int
    public var perTable: Int
}

public struct CapacityInfo: Equatable, Sendable {
    public var guests: Int
    public var seats: Int
    public var regularGuests: Int
    public var regularSeats: Int
    public var missing: Int
}

/// Kao JavaScriptov Math.round (pola prema +beskonačnosti).
private func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

private struct Pos { var x: Double; var y: Double; var rotation: Double }

private let hallTop = 110.0
private let tableClearance = 10.0
private let headFrontSeats = 6.0

extension Record {
    fileprivate var isHeadTable: Bool { string("shape") == "head" }
    fileprivate var isWeddingParty: Bool { isTruthy("party") }
}

extension WeddingData {
    public var invitedGuests: [Record] { guests.filter { !$0.isWeddingParty } }

    // MARK: Kapacitet

    private func seatsOf(_ t: Record) -> Double { t.number("seats") ?? 0 }

    private func headPartyCount(_ headSeats: Double) -> Double {
        let headCats = Set(categories.filter { $0.isTruthy("atHeadTable") }.compactMap { $0.id })
        let party = invitedGuests.filter {
            guard $0.string("status") != "maybe", let c = $0.string("categoryId"), !c.isEmpty else { return false }
            return headCats.contains(c)
        }.count
        return min(Double(party), headSeats)
    }

    private func headSeatsTotal() -> Double {
        let seats = tables.filter { $0.isHeadTable }.reduce(0) { $0 + seatsOf($1) }
        return max(0, seats - Double(guests.filter { $0.isWeddingParty }.count))
    }

    public func capacityInfo() -> CapacityInfo {
        let guestCount = invitedGuests.filter { $0.string("status") != "maybe" }.count
        let party = guests.filter { $0.isWeddingParty }.count
        let seats = tables.reduce(0) { $0 + seatsOf($1) } - Double(party)
        let headSeats = headSeatsTotal()
        let regularSeats = seats - headSeats
        let regularGuests = Double(guestCount) - headPartyCount(headSeats)
        return CapacityInfo(
            guests: guestCount, seats: seats.safeInt, regularGuests: regularGuests.safeInt,
            regularSeats: regularSeats.safeInt, missing: max(0, regularGuests - regularSeats).safeInt)
    }

    // MARK: Izgradnja stolova

    private func tablesNeeded(_ guestCount: Double, _ perTable: Double) -> Int {
        perTable > 0 ? (max(0, guestCount) / perTable).rounded(.up).safeInt : 0
    }

    private func makeHallTable(_ template: HallTemplate, _ perTable: Int, _ name: String,
                               _ x: Double, _ y: Double, _ rotation: Double, makeID: IDMaker) -> Record {
        var f: [String: JSONValue] = [
            "id": .string(makeID()), "name": .string(name),
            "x": .number(jsRound(x)), "y": .number(jsRound(y)), "rotation": .number(rotation)
        ]
        if template == .round {
            f["shape"] = .string("round")
            f["seats"] = .number(Double(perTable))
        } else {
            let seatsLong = max(1, (Double(perTable) / 2).rounded(.up))
            f["shape"] = .string("royal")
            f["seats"] = .number(seatsLong * 2)
            f["seatsLong"] = .number(seatsLong)
            f["seatsEnd"] = .number(0)
        }
        return Record(f)
    }

    private func makeHeadTable(makeID: IDMaker) -> Record {
        Record([
            "id": .string(makeID()), "name": .string("Stol mladenaca"), "shape": .string("head"),
            "seats": .number(headFrontSeats), "seatsLong": .number(headFrontSeats), "seatsEnd": .number(0),
            "x": .number(500), "y": .number(60), "rotation": .number(0)
        ])
    }

    private func longTableLength(_ perTable: Int) -> Double {
        max(200, (Double(perTable) / 2).rounded(.up) * 28 + 20)
    }

    private func rowX(_ col: Int, _ count: Int, _ cols: Int, _ step: Double) -> Double {
        let n = Double(min(count, cols))
        return 500 + (Double(col) - (n - 1) / 2) * step
    }

    private func hallPositions(_ template: HallTemplate, _ count: Int, _ perTable: Int, _ top: Double) -> [Pos] {
        var out: [Pos] = []
        switch template {
        case .u:
            let len = longTableLength(perTable)
            let left = (Double(count) / 2).rounded(.up)
            for i in 0..<count {
                let arm = Double(i) < left ? 0 : 1
                let k = arm == 0 ? Double(i) : Double(i) - left
                out.append(Pos(x: arm == 0 ? 290 : 710, y: top + 40 + len / 2 + k * (len + 24), rotation: 90))
            }
        case .long:
            let len = longTableLength(perTable)
            let cols = len > 280 ? 2 : 3
            let gap = (1000 - Double(cols) * len) / Double(cols + 1)
            for i in 0..<count {
                let col = i % cols, row = i / cols
                out.append(Pos(x: rowX(col, count, cols, len + gap), y: top + 55 + Double(row) * 150, rotation: 0))
            }
        case .round:
            let cols = 5
            for i in 0..<count {
                let col = i % cols, row = i / cols
                out.append(Pos(x: rowX(col, count, cols, 190), y: top + 70 + Double(row) * 175, rotation: 0))
            }
        }
        return out
    }

    private func nextTableNumber() -> Int {
        var maxN = 0
        for t in tables {
            guard let name = t.string("name"), name.hasPrefix("Stol ") else { continue }
            let rest = name.dropFirst(5)
            guard !rest.isEmpty, rest.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(rest) else { continue }
            maxN = max(maxN, n)
        }
        return maxN + 1
    }

    private func isTurned(_ t: Record) -> Bool {
        let r = t.number("rotation") ?? 0
        let m = r.truncatingRemainder(dividingBy: 180)
        return (m + 180).truncatingRemainder(dividingBy: 180) == 90
    }

    /// Pola širine/visine koju stol zauzima na tlocrtu, sa sjedalima.
    private func tableExtent(_ t: Record) -> (hw: Double, hh: Double) {
        var hw: Double, hh: Double
        let shape = t.string("shape")
        if shape == "round" {
            hw = 70; hh = 70
        } else {
            var (w, h): (Double, Double)
            switch shape {
            case "square": (w, h) = (80, 80)
            case "royal": (w, h) = (200, 50)
            case "head": (w, h) = (260, 55)
            default: (w, h) = (110, 70)
            }
            let longDefined = t["seatsLong"] != nil
            func orZero(_ v: Double?) -> Double { if let v, v.isFinite, v != 0 { return v }; return 0 }
            if shape != "square" && longDefined {
                w = max(w, orZero(t.number("seatsLong")) * 28 + 20)
                if shape != "head" { h = max(h, orZero(t.number("seatsEnd")) * 28 + 20) }
            }
            let endSeats = shape == "square" || !longDefined || (t.number("seatsEnd") ?? 0) > 0
            hw = w / 2 + (endSeats ? 24 : 0)
            hh = h / 2 + (shape == "head" ? 12 : 24)
        }
        return isTurned(t) ? (hh, hw) : (hw, hh)
    }

    public func currentHallTemplateForUI() -> HallTemplate { currentHallTemplate() }

    func currentHallTemplate() -> HallTemplate {
        let regular = tables.filter { !$0.isHeadTable }
        if regular.isEmpty || regular.contains(where: { $0.string("shape") == "round" }) { return .round }
        return regular.allSatisfy { isTurned($0) } ? .u : .long
    }

    private func hallSlots(_ template: HallTemplate, _ perTable: Int, _ n: Int) -> [Pos] {
        if template != .u { return hallPositions(template, n, perTable, hallTop) }
        let arms = hallPositions(.u, n * 2, perTable, hallTop)
        var out: [Pos] = []
        for k in 0..<n { out.append(arms[k]); out.append(arms[n + k]) }
        return out
    }

    /// Vraća funkciju koja gradi stol na sljedećem slobodnom mjestu predloška
    /// (iza zadnjeg već zauzetog), bez preklapanja s postojećim stolovima.
    private func tablePlacer(_ template: HallTemplate, _ perTable: Int, makeID: @escaping IDMaker)
        -> (_ build: (Pos) -> Record) -> Record {
        struct Placed { var x: Double; var y: Double; var hw: Double; var hh: Double }
        var placed: [Placed] = tables.map {
            let e = tableExtent($0)
            return Placed(x: $0.number("x") ?? .nan, y: $0.number("y") ?? .nan, hw: e.hw, hh: e.hh)
        }
        func clashes(_ t: Record) -> Bool {
            let e = tableExtent(t)
            let x = t.number("x") ?? .nan, y = t.number("y") ?? .nan
            return placed.contains {
                abs(x - $0.x) < e.hw + $0.hw + tableClearance && abs(y - $0.y) < e.hh + $0.hh + tableClearance
            }
        }
        let slots = hallSlots(template, perTable, 600 + placed.count * 2)
        var next = 0
        for (i, s) in slots.enumerated() {
            // JavaScript ovdje gradi probni stol (i troši jedan id); isto radimo da nizovi ostanu jednaki.
            if clashes(makeHallTable(template, perTable, "", s.x, s.y, s.rotation, makeID: makeID)) { next = i + 1 }
        }
        let box = Box(next)
        return { build in
            while box.value < slots.count {
                let t = build(slots[box.value])
                box.value += 1
                if !clashes(t) {
                    placed.append(Placed(x: t.number("x") ?? .nan, y: t.number("y") ?? .nan,
                                         hw: self.tableExtent(t).hw, hh: self.tableExtent(t).hh))
                    return t
                }
            }
            let bottom = placed.reduce(0) { max($0, $1.y + $1.hh) }
            var t = build(Pos(x: 500, y: bottom, rotation: 0))
            let e = self.tableExtent(t)
            t["y"] = .number(jsRound(bottom + e.hh + 40))
            placed.append(Placed(x: t.number("x") ?? .nan, y: t.number("y") ?? .nan, hw: e.hw, hh: e.hh))
            return t
        }
    }

    /// Novi stol ide na sljedeće slobodno mjesto rasporeda sale.
    public func placeNewTable(_ table: Record, makeID: @escaping IDMaker = newRecordID) -> Record {
        let template = currentHallTemplate()
        let regular = tables.filter { !$0.isHeadTable }
        let perTable = regular.first.map { seatsOf($0).safeInt } ?? template.defaultSeats
        let place = tablePlacer(template, perTable, makeID: makeID)
        return place { p in
            var t = table
            t["x"] = .number(jsRound(p.x))
            t["y"] = .number(jsRound(p.y))
            return t
        }
    }

    /// Plan sale: "rebuild" mijenja sve obične stolove, "add" dodaje samo potrebne na kraj.
    public func planHall(template: HallTemplate, guestCount: Int, perTable: Int, mode: HallMode,
                         makeID: @escaping IDMaker = newRecordID) -> HallPlan {
        let heads = tables.filter { $0.isHeadTable }
        var create: [Record] = []
        let headSeats = heads.isEmpty ? headFrontSeats : headSeatsTotal()
        let regularGuests = max(0, Double(guestCount) - headPartyCount(headSeats))
        if mode == .rebuild {
            if heads.isEmpty { create.append(makeHeadTable(makeID: makeID)) }
            let count = tablesNeeded(regularGuests, Double(perTable))
            for (i, p) in hallPositions(template, count, perTable, hallTop).enumerated() {
                create.append(makeHallTable(template, perTable, "Stol \(i + 1)", p.x, p.y, p.rotation, makeID: makeID))
            }
            return HallPlan(create: create, remove: tables.filter { !$0.isHeadTable }.compactMap { $0.id },
                            count: count, perTable: perTable)
        }
        let regularSeats = tables.filter { !$0.isHeadTable }.reduce(0) { $0 + seatsOf($1) }
        let count = tablesNeeded(regularGuests - regularSeats, Double(perTable))
        let first = nextTableNumber()
        let place = tablePlacer(template, perTable, makeID: makeID)
        for i in 0..<count {
            create.append(place { p in
                makeHallTable(template, perTable, "Stol \(first + i)", p.x, p.y, p.rotation, makeID: makeID)
            })
        }
        return HallPlan(create: create, remove: [], count: count, perTable: perTable)
    }

    // MARK: Uređivanje stolova

    /// Gosti na mjestima koja više ne postoje (stol je smanjen) dobivaju slobodna
    /// mjesta istog stola ili ostaju bez mjesta. Vraća promijenjene goste.
    public func reseatOverflowGuests(table: Record) -> [Record] {
        guard let tid = table.id else { return [] }
        let seats = table.number("seats") ?? .nan
        let seated = guests.filter { $0.string("tableId") == tid }
        func fits(_ g: Record) -> Bool {
            guard let s = g.integer("seatIndex") else { return false }
            return s >= 0 && s < seats
        }
        var overflow = seated.enumerated().filter { !fits($0.element) }
        if overflow.isEmpty { return [] }
        let taken = Set(seated.filter(fits).compactMap { $0.integer("seatIndex") })
        var free: [Double] = []
        var i = 0.0
        while i < seats { if !taken.contains(i) { free.append(i) }; i += 1 }
        overflow.sort { a, b in
            let la = a.element.isTruthy("locked") ? 1 : 0, lb = b.element.isTruthy("locked") ? 1 : 0
            if la != lb { return la > lb }
            let sa = a.element.number("seatIndex") ?? 0, sb = b.element.number("seatIndex") ?? 0
            if sa != sb { return sa < sb }
            return a.offset < b.offset
        }
        return overflow.map { _, g in
            var g = g
            if !free.isEmpty {
                g["seatIndex"] = .number(free.removeFirst())
            } else {
                g["tableId"] = .null
                g["seatIndex"] = .null
                g["status"] = .string("unassigned")
            }
            return g
        }
    }
}

private final class Box {
    var value: Int
    init(_ v: Int) { value = v }
}
