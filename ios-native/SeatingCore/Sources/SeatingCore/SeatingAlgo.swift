import Foundation

/// Pravilo koje nije moguće ispuniti.
public struct RuleViolation: Equatable, Sendable {
    public var ruleId: String?
    public var reason: String
    public init(ruleId: String?, reason: String) { self.ruleId = ruleId; self.reason = reason }
}

/// Rezultat automatskog slaganja. `assignments` s `tableId == nil` znači "bez mjesta".
public struct SeatingSuggestion: Equatable, Sendable {
    public var assignments: [SeatMove]
    public var violations: [RuleViolation]
}

/// Port js/seating-algo.js (suggestSeating). Redoslijed obrade namjerno prati
/// JavaScript (redoslijed ključeva objekta, stabilno sortiranje), da rezultat
/// bude isti kao na webu.
private struct Slot { var tableId: String; var seat: Double? }

private struct OrderedSlots {
    var keys: [String] = []
    var map: [String: Slot] = [:]
    subscript(id: String) -> Slot? {
        get { map[id] }
        set {
            if let v = newValue {
                if map[id] == nil { keys.append(id) }
                map[id] = v
            } else if map[id] != nil {
                map[id] = nil
                keys.removeAll { $0 == id }
            }
        }
    }
    var entries: [(String, Slot)] { keys.map { ($0, map[$0]!) } }
}

private func jsSeatCount(_ t: Record) -> Int { FloorGeometry.count(t.number("seats")) }

private func guestIds(_ r: Record) -> [String] {
    (r["guestIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
}

extension WeddingData {
    public func suggestSeating() -> SeatingSuggestion {
        let headTableIds = Set(tables.filter { $0.string("shape") == "head" }.compactMap { $0.id })
        let headCatIds = Set(categories.filter { $0.isTruthy("atHeadTable") }.compactMap { $0.id })
        let togetherRules = rules.filter { $0.string("type") == "together" || $0.string("type") == "companion" }

        func gid(_ g: Record) -> String { g.id ?? "" }
        func isMaybe(_ g: Record) -> Bool { g.string("status") == "maybe" }
        func tableOf(_ g: Record) -> String? { g.string("tableId").flatMap { $0.isEmpty ? nil : $0 } }

        // Mladenci i kumovi: kategorije za stol mladenaca, već tamo smješteni,
        // te svi povezani pravilom "zajedno".
        var headGuestIds = Set<String>()
        for g in guests where !isMaybe(g) {
            let inCat = g.string("categoryId").map { !$0.isEmpty && headCatIds.contains($0) } ?? false
            let atHead = g.string("tableId").map { headTableIds.contains($0) } ?? false
            if inCat || atHead { headGuestIds.insert(gid(g)) }
        }
        var grew = true
        while grew {
            grew = false
            for r in togetherRules {
                let ids = guestIds(r)
                if ids.contains(where: { headGuestIds.contains($0) }) {
                    for id in ids where !headGuestIds.contains(id) { headGuestIds.insert(id); grew = true }
                }
            }
        }

        // Slobodna mjesta po stolu (stolovi mladenaca se pune posebnim prolazom).
        var seatMap: [String: [Int]] = [:]
        for t in tables {
            guard let tid = t.id else { continue }
            if headTableIds.contains(tid) { seatMap[tid] = []; continue }
            var occupied = Set<Double>()
            for g in guests where g.string("tableId") == tid && g.isTruthy("locked") {
                if let s = g.number("seatIndex") { occupied.insert(s) }
            }
            seatMap[tid] = (0..<jsSeatCount(t)).filter { !occupied.contains(Double($0)) }
        }

        // Zaključani i oni već za stolom mladenaca ostaju gdje jesu.
        var assignments = OrderedSlots()
        for g in guests {
            if let tid = tableOf(g), g.isTruthy("locked") || headTableIds.contains(tid) {
                assignments[gid(g)] = Slot(tableId: tid, seat: g.number("seatIndex"))
            }
        }

        // Prolaz za stol mladenaca.
        for t in tables {
            guard let tid = t.id, headTableIds.contains(tid) else { continue }
            var occupied = Set<Double>()
            for (_, a) in assignments.entries where a.tableId == tid { if let s = a.seat { occupied.insert(s) } }
            var free = (0..<jsSeatCount(t)).filter { !occupied.contains(Double($0)) }
            let needy = guests.filter {
                headGuestIds.contains(gid($0)) && assignments[gid($0)] == nil && !$0.isTruthy("locked") && !isMaybe($0)
            }
            for g in needy {
                if free.isEmpty { break }
                assignments[gid(g)] = Slot(tableId: tid, seat: Double(free.removeFirst()))
            }
        }

        let toPlace = guests.filter { !$0.isTruthy("locked") && !isMaybe($0) && assignments[gid($0)] == nil }

        // Fiksna pravila.
        let fixedRules = rules.filter { $0.string("type") == "fixed" }
        for rule in fixedRules {
            guard let g0 = guestIds(rule).first,
                  toPlace.contains(where: { gid($0) == g0 }),
                  let tid = rule.string("tableId"),
                  tables.contains(where: { $0.id == tid }),
                  var free = seatMap[tid] else { continue }
            var seatIdx: Double?
            switch rule["seatIndex"] {
            case .some(.null): seatIdx = free.first.map(Double.init)
            case .some(.number(let n)): seatIdx = n
            default: seatIdx = nil // undefined u JS-u
            }
            guard let want = seatIdx, let at = free.firstIndex(where: { Double($0) == want }) else { continue }
            free.remove(at: at)
            seatMap[tid] = free
            assignments[g0] = Slot(tableId: tid, seat: want)
        }

        // Grupiranje po kategoriji (redoslijed prvog pojavljivanja).
        let unplaced = toPlace.filter { assignments[gid($0)] == nil }
        var catOrder: [String] = []
        var byCategory: [String: [Record]] = [:]
        var noCat: [Record] = []
        for g in unplaced {
            if let c = g.string("categoryId"), !c.isEmpty {
                if byCategory[c] == nil { catOrder.append(c); byCategory[c] = [] }
                byCategory[c]!.append(g)
            } else {
                noCat.append(g)
            }
        }

        var catTogetherOrder: [String] = []
        for r in rules where r.string("type") == "category-together" {
            if let c = r.string("categoryId"), !catTogetherOrder.contains(c) { catTogetherOrder.append(c) }
        }
        let catTogetherIds = Set(catTogetherOrder)

        // Stolovi s slobodnim mjestima, najviše mjesta prvo (stabilno kao JS sort).
        func tablesBySpace() -> [Record] {
            let withIdx = tables.enumerated().filter { (seatMap[$0.element.id ?? ""]?.count ?? 0) > 0 }
            return withIdx.sorted { a, b in
                let ca = seatMap[a.element.id ?? ""]?.count ?? 0
                let cb = seatMap[b.element.id ?? ""]?.count ?? 0
                return ca != cb ? ca > cb : a.offset < b.offset
            }.map { $0.element }
        }

        var immovable = Set(guests.filter { $0.isTruthy("locked") }.map(gid))
        for (id, a) in assignments.entries where headTableIds.contains(a.tableId) { immovable.insert(id) }
        for r in fixedRules { if let g0 = guestIds(r).first { immovable.insert(g0) } }

        // Kategorija "zajedno" ima prednost: rezervira cijeli stol.
        for catId in catTogetherOrder {
            let group = (byCategory[catId] ?? []).filter { assignments[gid($0)] == nil }
            if group.isEmpty { continue }
            let candidates: [(t: Record, room: Double, idx: Int)] = tables.enumerated().compactMap { (i, t) in
                guard let tid = t.id, !headTableIds.contains(tid) else { return nil }
                let here = assignments.entries.filter { $0.1.tableId == tid && immovable.contains($0.0) }.count
                let room = (t.number("seats") ?? .nan) - Double(here)
                return room >= Double(group.count) ? (t, room, i) : nil
            }
            // JS: sort po broju slobodnih mjesta silazno, stabilno; uzima se prvi.
            let best = candidates.sorted { a, b in
                let fa = seatMap[a.t.id ?? ""]?.count ?? 0
                let fb = seatMap[b.t.id ?? ""]?.count ?? 0
                return fa != fb ? fa > fb : a.idx < b.idx
            }.first
            guard let cand = best, let tid = cand.t.id else { continue }
            for (id, a) in assignments.entries where a.tableId == tid && !immovable.contains(id) {
                assignments[id] = nil
            }
            var occupied = Set<Double>()
            for (_, a) in assignments.entries where a.tableId == tid { if let s = a.seat { occupied.insert(s) } }
            var free = (0..<jsSeatCount(cand.t)).filter { !occupied.contains(Double($0)) }
            for g in group {
                if free.isEmpty { break }
                assignments[gid(g)] = Slot(tableId: tid, seat: Double(free.removeFirst()))
                immovable.insert(gid(g))
            }
            seatMap[tid] = free
        }

        func take(_ t: Record, for g: Record) {
            guard let tid = t.id, !(seatMap[tid] ?? []).isEmpty else { return }
            let seat = seatMap[tid]!.removeFirst()
            assignments[gid(g)] = Slot(tableId: tid, seat: Double(seat))
        }

        for catId in catOrder {
            let group = (byCategory[catId] ?? []).filter { assignments[gid($0)] == nil }
            if group.isEmpty { continue }
            if catTogetherIds.contains(catId),
               let t = tablesBySpace().first(where: { (seatMap[$0.id ?? ""]?.count ?? 0) >= group.count }) {
                for g in group { take(t, for: g) }
                continue
            }
            for g in group {
                if assignments[gid(g)] != nil { continue }
                guard let t = tablesBySpace().first else { continue }
                take(t, for: g)
            }
        }
        for g in noCat {
            if assignments[gid(g)] != nil { continue }
            guard let t = tablesBySpace().first else { continue }
            take(t, for: g)
        }

        // Lokalno poboljšanje: pomicanja i zamjene dok se smanjuju prekršaji.
        var locked = Set(guests.filter { $0.isTruthy("locked") }.map(gid))
        for (id, a) in assignments.entries where headTableIds.contains(a.tableId) { locked.insert(id) }

        var catGuestIds: [String: [String]] = [:]
        for r in rules where r.string("type") == "category-together" {
            if let rid = r.id {
                catGuestIds[rid] = guests.filter { $0.string("categoryId") == r.string("categoryId") && r.string("categoryId") != nil }.map(gid)
            }
        }

        let order = assignments.keys
        var slots: [String: Slot] = assignments.map

        func countViolations() -> Int {
            var v = 0
            for rule in rules {
                let type = rule.string("type")
                if type == "apart" {
                    let placed = guestIds(rule).compactMap { slots[$0] }
                    if placed.count >= 2 && Set(placed.map { $0.tableId }).count < placed.count { v += 1 }
                } else if type == "together" || type == "companion" {
                    let placed = guestIds(rule).compactMap { slots[$0] }
                    if placed.count >= 2 && Set(placed.map { $0.tableId }).count > 1 { v += 1 }
                } else if type == "category-together" {
                    let placed = (rule.id.flatMap { catGuestIds[$0] } ?? []).compactMap { slots[$0] }
                    if placed.count >= 2 && Set(placed.map { $0.tableId }).count > 1 { v += 1 }
                }
            }
            return v
        }

        let movable = order.filter { !locked.contains($0) }
        var freeByTable: [String: [Int]] = [:]
        for t in tables {
            guard let tid = t.id else { continue }
            if headTableIds.contains(tid) { freeByTable[tid] = []; continue }
            var occupied = Set<Double>()
            for (_, a) in slots where a.tableId == tid { if let s = a.seat { occupied.insert(s) } }
            freeByTable[tid] = (0..<jsSeatCount(t)).filter { !occupied.contains(Double($0)) }
        }

        var bestScore = countViolations()
        var improved = true
        var passes = 0
        while improved && bestScore > 0 && passes < 12 {
            improved = false
            passes += 1

            var i = 0
            while i < movable.count && bestScore > 0 {
                let id = movable[i]
                let from = slots[id]!
                for t in tables {
                    guard let tid = t.id else { continue }
                    if tid == from.tableId || headTableIds.contains(tid) { continue }
                    guard let free = freeByTable[tid], !free.isEmpty else { continue }
                    slots[id] = Slot(tableId: tid, seat: Double(free[0]))
                    let score = countViolations()
                    if score < bestScore {
                        bestScore = score
                        improved = true
                        freeByTable[tid]!.removeFirst()
                        if let s = from.seat, s == s.rounded() { freeByTable[from.tableId, default: []].append(Int(s)) }
                        break
                    } else {
                        slots[id] = from
                    }
                }
                i += 1
            }

            i = 0
            while i < movable.count && bestScore > 0 {
                var j = i + 1
                while j < movable.count {
                    let ia = movable[i], ib = movable[j]
                    let a = slots[ia]!, b = slots[ib]!
                    if a.tableId == b.tableId { j += 1; continue }
                    slots[ia] = Slot(tableId: b.tableId, seat: b.seat)
                    slots[ib] = Slot(tableId: a.tableId, seat: a.seat)
                    let score = countViolations()
                    if score < bestScore {
                        bestScore = score
                        improved = true
                        if bestScore == 0 { break }
                    } else {
                        slots[ia] = a
                        slots[ib] = b
                    }
                    j += 1
                }
                i += 1
            }
        }
        var result: [SeatMove] = order.map { SeatMove(id: $0, tableId: slots[$0]!.tableId, seatIndex: slots[$0]!.seat) }
        for g in toPlace where slots[gid(g)] == nil {
            result.append(SeatMove(id: gid(g), tableId: nil, seatIndex: nil))
        }

        // Izvještaj o prekršajima.
        func name(_ id: String) -> String { guests.first { $0.id == id }?.string("name") ?? id }
        var violations: [RuleViolation] = []
        for rule in rules {
            let type = rule.string("type")
            if type == "apart" {
                let ids = guestIds(rule)
                let placed = ids.compactMap { slots[$0] }
                if placed.count >= 2 && Set(placed.map { $0.tableId }).count < placed.count {
                    violations.append(RuleViolation(ruleId: rule.id, reason: "Gosti moraju biti odvojeni: \(ids.map(name).joined(separator: ", "))"))
                }
            } else if type == "together" || type == "companion" {
                let ids = guestIds(rule)
                let placed = ids.compactMap { slots[$0] }
                if placed.count >= 2 && Set(placed.map { $0.tableId }).count > 1 {
                    violations.append(RuleViolation(ruleId: rule.id, reason: "Gosti moraju biti zajedno: \(ids.map(name).joined(separator: ", "))"))
                }
            } else if type == "category-together" {
                let cat = rule.string("categoryId")
                let placed = guests.filter { $0.string("categoryId") == cat && cat != nil }.compactMap { slots[gid($0)] }
                if placed.count >= 2 && Set(placed.map { $0.tableId }).count > 1 {
                    let catName = categories.first { $0.id == cat }?.string("name") ?? cat ?? ""
                    violations.append(RuleViolation(ruleId: rule.id, reason: "Kategorija \"\(catName)\" nije na istom stolu"))
                }
            }
        }
        return SeatingSuggestion(assignments: result, violations: violations)
    }

    /// Primjenjuje prijedlog (kao applySeatingResult): zaključani gosti se ne diraju.
    @discardableResult
    public mutating func apply(_ suggestion: SeatingSuggestion) -> [String] {
        let moves = suggestion.assignments.filter { m in
            guard let g = guests.first(where: { $0.id == m.id }) else { return false }
            return !g.isTruthy("locked")
        }
        return place(moves)
    }
}
