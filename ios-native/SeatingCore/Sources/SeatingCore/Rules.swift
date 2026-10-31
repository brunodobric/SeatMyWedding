import Foundation

/// Razlika između dva popisa pravila: što treba spremiti i što obrisati.
public struct RulesDiff: Equatable, Sendable {
    public var changed: [Record]
    public var removedIds: [String]
    public var isEmpty: Bool { changed.isEmpty && removedIds.isEmpty }
}

/// Port pravila iz js/state.js: normalizeRules, setGuestRelations,
/// setCategoryTogether, addTogetherGroups i evaluateRule.
///
/// Normalizirani oblik: "together" jedna skupina po grupi (2+ gosta),
/// "apart" jedan par po pravilu, "fixed" najviše jedno po gostu,
/// "category-together" najviše jedno po kategoriji.
public typealias IDMaker = () -> String

public func newRecordID() -> String { UUID().uuidString.lowercased() }

private func ruleGuestIds(_ r: Record) -> [String] {
    (r["guestIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
}

private func makeRule(id: String?, type: String, guestIds: [String], categoryId: String? = nil,
                      tableId: String? = nil, seatIndex: Double? = nil) -> Record {
    var f: [String: JSONValue] = [
        "type": .string(type),
        "guestIds": .array(guestIds.map { .string($0) }),
        "categoryId": categoryId.map { .string($0) } ?? .null,
        "tableId": tableId.map { .string($0) } ?? .null,
        "seatIndex": seatIndex.map { .number($0) } ?? .null
    ]
    if let id { f["id"] = .string(id) }
    return Record(f)
}

private func isInteger(_ n: Double?) -> Bool {
    guard let n, n.isFinite else { return false }
    return n == n.rounded()
}

extension WeddingData {
    public func normalizeRules(_ rules: [Record], makeID: IDMaker = newRecordID) -> [Record] {
        let guestSet = Set(guests.compactMap { $0.id })
        let tableSet = Set(tables.compactMap { $0.id })
        let catSet = Set(categories.compactMap { $0.id })
        var out: [Record] = []

        // together: spajanje preklapajućih skupina (zajedništvo je prijenosno)
        var parentOrder: [String] = []
        var parent: [String: String] = [:]
        func find(_ start: String) -> String {
            var id = start
            while parent[id] != id { id = parent[id]! }
            return id
        }
        var groupRuleId: [String: String] = [:]
        for r in rules {
            let t = r.string("type")
            guard t == "together" || t == "companion" else { continue }
            let ids = ruleGuestIds(r).filter { guestSet.contains($0) }
            for id in ids where parent[id] == nil { parent[id] = id; parentOrder.append(id) }
            if ids.count > 1 {
                for i in 1..<ids.count {
                    let a = find(ids[i]), b = find(ids[0])
                    parent[a] = b
                }
            }
            if let first = ids.first, groupRuleId[first] == nil, let rid = r.id { groupRuleId[first] = rid }
        }
        var groupOrder: [String] = []
        var groups: [String: [String]] = [:]
        for id in parentOrder {
            let root = find(id)
            if groups[root] == nil { groupOrder.append(root); groups[root] = [] }
            groups[root]!.append(id)
        }
        for root in groupOrder {
            let members = groups[root]!
            if members.count < 2 { continue }
            let id = members.compactMap { groupRuleId[$0] }.first ?? makeID()
            out.append(makeRule(id: id, type: "together", guestIds: members))
        }

        // apart: jedno pravilo po paru
        var pairs = Set<String>()
        for r in rules where r.string("type") == "apart" {
            var seen = Set<String>()
            let ids = ruleGuestIds(r).filter { guestSet.contains($0) && seen.insert($0).inserted }
            for i in 0..<ids.count {
                for j in (i + 1)..<max(ids.count, i + 1) {
                    let key = [ids[i], ids[j]].sorted().joined(separator: "|")
                    if pairs.contains(key) { continue }
                    pairs.insert(key)
                    let id = ids.count == 2 ? r.id : makeID()
                    out.append(makeRule(id: id, type: "apart", guestIds: [ids[i], ids[j]]))
                }
            }
        }

        // fixed: posljednje po gostu pobjeđuje (položaj prvog unosa se čuva)
        var fixedOrder: [String] = []
        var fixed: [String: Record] = [:]
        for r in rules where r.string("type") == "fixed" {
            guard let gid = ruleGuestIds(r).first, guestSet.contains(gid),
                  let tid = r.string("tableId"), tableSet.contains(tid) else { continue }
            if fixed[gid] == nil { fixedOrder.append(gid) }
            fixed[gid] = makeRule(id: r.id, type: "fixed", guestIds: [gid], tableId: tid,
                                  seatIndex: isInteger(r.number("seatIndex")) ? r.number("seatIndex") : nil)
        }
        out.append(contentsOf: fixedOrder.map { fixed[$0]! })

        // category-together: jedno po kategoriji
        var cats = Set<String>()
        for r in rules where r.string("type") == "category-together" {
            guard let c = r.string("categoryId"), catSet.contains(c), !cats.contains(c) else { continue }
            cats.insert(c)
            out.append(makeRule(id: r.id, type: "category-together", guestIds: [], categoryId: c))
        }
        return out
    }

    /// Što treba zapisati da bi se `rules` zamijenila s `next` (kao replaceRules).
    public func diffRules(to next: [Record]) -> RulesDiff {
        func key(_ r: Record) -> JSONValue {
            .array([r["type"] ?? .null, r["guestIds"] ?? .null, r["categoryId"] ?? .null,
                    r["tableId"] ?? .null, r["seatIndex"] ?? .null])
        }
        let prev = Dictionary(rules.compactMap { r in r.id.map { ($0, r) } }, uniquingKeysWith: { $1 })
        let nextIds = Set(next.compactMap { $0.id })
        let removed = rules.compactMap { $0.id }.filter { !nextIds.contains($0) }
        let changed = next.filter { r in
            guard let id = r.id, let old = prev[id] else { return true }
            return key(old) != key(r)
        }.map { r -> Record in var c = r; c["satisfied"] = nil; return c }
        return RulesDiff(changed: changed, removedIds: removed)
    }

    /// Nova pravila nakon uređivanja odnosa gosta s kartice gosta.
    public func rulesAfterSettingRelations(
        guestId: String, together togetherIn: [String], apart apartIn: [String],
        fixedTableId: String?, fixedSeat: Double?, makeID: IDMaker = newRecordID
    ) -> [Record] {
        var together: [String] = []
        for id in togetherIn where id != guestId && !together.contains(id) { together.append(id) }
        var apart: [String] = []
        for id in apartIn where id != guestId && !together.contains(id) && !apart.contains(id) { apart.append(id) }

        var list = rules
        var merged: [String] = [guestId]
        for id in together where !merged.contains(id) { merged.append(id) }

        list = list.compactMap { r in
            guard r.string("type") == "together" else { return r }
            var r = r
            let ids = ruleGuestIds(r)
            if ids.contains(guestId) {
                let kept = ids.filter { $0 != guestId && !together.contains($0) }
                r["guestIds"] = .array(kept.map { .string($0) })
                return kept.count >= 2 ? r : nil
            }
            if ids.contains(where: { together.contains($0) }) {
                for id in ids where !merged.contains(id) { merged.append(id) }
                return nil
            }
            return r
        }
        if merged.count >= 2 {
            let old = rules.first { $0.string("type") == "together" && ruleGuestIds($0).contains(guestId) }
            let reuse: String
            if let old, let oid = old.id, !list.contains(where: { $0.id == oid }) { reuse = oid } else { reuse = makeID() }
            list.append(makeRule(id: reuse, type: "together", guestIds: merged))
        }

        var oldApart: [String: String] = [:]
        list = list.filter { r in
            guard r.string("type") == "apart", ruleGuestIds(r).contains(guestId) else { return true }
            if let other = ruleGuestIds(r).first(where: { $0 != guestId }), let rid = r.id { oldApart[other] = rid }
            return false
        }
        for other in apart {
            list.append(makeRule(id: oldApart[other] ?? makeID(), type: "apart", guestIds: [guestId, other]))
        }

        let oldFixed = list.first { $0.string("type") == "fixed" && ruleGuestIds($0).first == guestId }
        list = list.filter { !($0.string("type") == "fixed" && ruleGuestIds($0).first == guestId) }
        if let tid = fixedTableId, !tid.isEmpty {
            list.append(makeRule(id: oldFixed?.id ?? makeID(), type: "fixed", guestIds: [guestId], tableId: tid,
                                 seatIndex: isInteger(fixedSeat) ? fixedSeat : nil))
        }
        return normalizeRules(list, makeID: makeID)
    }

    /// Dodaje parove/obitelji iz uvoza kao "zajedno" skupine.
    public func rulesAfterAddingTogether(_ groups: [[String]], makeID: IDMaker = newRecordID) -> [Record] {
        var list = rules
        for ids in groups where ids.count >= 2 { list.append(makeRule(id: makeID(), type: "together", guestIds: ids)) }
        return normalizeRules(list, makeID: makeID)
    }

    public func isCategoryTogether(_ categoryId: String) -> Bool {
        rules.contains { $0.string("type") == "category-together" && $0.string("categoryId") == categoryId }
    }

    public func rulesAfterSettingCategoryTogether(_ categoryId: String, on: Bool, makeID: IDMaker = newRecordID) -> [Record] {
        if on == isCategoryTogether(categoryId) { return rules }
        if on { return rules + [makeRule(id: makeID(), type: "category-together", guestIds: [], categoryId: categoryId)] }
        return rules.filter { !($0.string("type") == "category-together" && $0.string("categoryId") == categoryId) }
    }

    /// Pravila koja se tiču gosta (izravno ili preko njegove kategorije).
    public func rules(for guest: Record) -> [Record] {
        rules.filter { r in
            if let id = guest.id, ruleGuestIds(r).contains(id) { return true }
            if r.string("type") == "category-together", let c = guest.string("categoryId"), !c.isEmpty,
               r.string("categoryId") == c { return true }
            return false
        }
    }

    /// Je li pravilo ispunjeno: true/false, ili nil kad se još ne može procijeniti.
    public func isSatisfied(_ rule: Record) -> Bool? {
        func guest(_ id: String) -> Record? { guests.first { $0.id == id } }
        func seated(_ g: Record) -> Bool { !(g.string("tableId") ?? "").isEmpty }
        switch rule.string("type") {
        case "apart":
            let assigned = ruleGuestIds(rule).compactMap { guest($0) }.filter(seated)
            if assigned.count < 2 { return nil }
            return Set(assigned.compactMap { $0.string("tableId") }).count == assigned.count
        case "together", "companion":
            let assigned = ruleGuestIds(rule).compactMap { guest($0) }.filter(seated)
            if assigned.count < 2 { return nil }
            return Set(assigned.compactMap { $0.string("tableId") }).count == 1
        case "fixed":
            guard let gid = ruleGuestIds(rule).first, let g = guest(gid), seated(g) else { return nil }
            if g.string("tableId") != rule.string("tableId") { return false }
            if case .some(.null) = rule["seatIndex"] { return true }
            return g.number("seatIndex") == rule.number("seatIndex")
        case "category-together":
            let cats = guests.filter { $0.string("categoryId") == rule.string("categoryId") && seated($0) }
            if cats.isEmpty { return nil }
            return Set(cats.compactMap { $0.string("tableId") }).count == 1
        default:
            return nil
        }
    }
}
