import Foundation

public struct Point: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct Size: Equatable, Sendable {
    public var w: Double
    public var h: Double
    public init(w: Double, h: Double) { self.w = w; self.h = h }
}

public struct Bounds: Equatable, Sendable {
    public var x1: Double, y1: Double, x2: Double, y2: Double
    public init(x1: Double, y1: Double, x2: Double, y2: Double) {
        self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2
    }
}

/// Geometrija tlocrta: veličine stolova, položaji mjesta i okvir sadržaja.
/// Port iz js/floor-plan.js (TABLE_DIMS, _dims, _getSeatPositions, _contentBounds);
/// koordinate su iste kao na webu pa ista sala izgleda isto na oba mjesta.
public enum FloorGeometry {
    public static let canvasWidth = 1000.0
    public static let canvasHeight = 700.0
    public static let worldSize = 2400.0
    public static let gridSize = 50.0
    public static let seatPitch = 28.0
    public static let roundRadius = 45.0
    public static let seatRadius = 10.0

    static func baseDims(_ shape: String?) -> Size {
        switch shape {
        case "round": return Size(w: 90, h: 90)
        case "square": return Size(w: 80, h: 80)
        case "royal": return Size(w: 200, h: 50)
        case "head": return Size(w: 260, h: 55)
        default: return Size(w: 110, h: 70)
        }
    }

    /// Veličina stola: dugi stolovi rastu s brojem mjesta uz stranice.
    public static func dims(_ table: Record) -> Size {
        let shape = table.string("shape")
        let base = baseDims(shape)
        if shape == "round" || shape == "square" || table["seatsLong"] == nil { return base }
        let end = table.number("seatsEnd") ?? 0
        let long = table.number("seatsLong") ?? 0
        return Size(
            w: max(base.w, long * seatPitch + 20),
            h: shape == "head" ? base.h : max(base.h, end * seatPitch + 20)
        )
    }

    /// Broj mjesta za petlju (kao `i < seats` u JavaScriptu).
    public static func count(_ n: Double?) -> Int {
        guard let n = n, n.isFinite, n > 0 else { return 0 }
        return Int(min(n, 10_000).rounded(.up))
    }

    /// Položaji mjesta u koordinatama stola (sredina stola je 0,0, prije rotacije).
    public static func seatPositions(_ table: Record) -> [Point] {
        var seats: [Point] = []
        let shape = table.string("shape")

        if shape == "round" {
            let total = table.number("seats") ?? 0
            let r = roundRadius + 14
            for i in 0..<count(total) {
                let angle = (2 * Double.pi * Double(i) / total) - Double.pi / 2
                seats.append(Point(x: cos(angle) * r, y: sin(angle) * r))
            }
            return seats
        }

        let d = dims(table)

        // Bez seatsLong mjesta se ravnomjerno raspoređuju po obodu.
        if table["seatsLong"] == nil {
            let total = table.number("seats") ?? 0
            let hw = d.w / 2 + 14
            let hh = d.h / 2 + 14
            let perimeter = 2 * (d.w + d.h)
            for i in 0..<count(total) {
                let t = (Double(i) / total) * perimeter
                let x: Double, y: Double
                if t < d.w { x = -d.w / 2 + t; y = -hh }
                else if t < d.w + d.h { x = hw; y = -d.h / 2 + (t - d.w) }
                else if t < 2 * d.w + d.h { x = d.w / 2 - (t - d.w - d.h); y = hh }
                else { x = -hw; y = d.h / 2 - (t - 2 * d.w - d.h) }
                seats.append(Point(x: x, y: y))
            }
            return seats
        }

        let hw = d.w / 2
        let hh = d.h / 2
        let off = 14.0
        let margin = 10.0
        let nLong = table.number("seatsLong") ?? 0
        let nEnd = shape == "square" ? nLong : (table.number("seatsEnd") ?? 0)

        func hLine(_ n: Double, _ y: Double, _ x1: Double, _ x2: Double) {
            let c = count(n)
            for i in 0..<c {
                let x = n == 1 ? (x1 + x2) / 2 : x1 + (x2 - x1) * Double(i) / (n - 1)
                seats.append(Point(x: x, y: y))
            }
        }
        func vLine(_ n: Double, _ x: Double, _ y1: Double, _ y2: Double) {
            let c = count(n)
            for i in 0..<c {
                let y = n == 1 ? (y1 + y2) / 2 : y1 + (y2 - y1) * Double(i) / (n - 1)
                seats.append(Point(x: x, y: y))
            }
        }

        if shape == "head" {
            hLine(nLong, -(hh + off), -hw + margin, hw - margin)
            vLine(nEnd, hw + off, -hh + margin, hh - margin)
            vLine(nEnd, -(hw + off), hh - margin, -hh + margin)
        } else {
            hLine(nLong, -(hh + off), -hw + margin, hw - margin)
            vLine(nEnd, hw + off, -hh + margin, hh - margin)
            hLine(nLong, hh + off, hw - margin, -hw + margin)
            vLine(nEnd, -(hw + off), hh - margin, -hh + margin)
        }
        return seats
    }

    /// Okvir svih stolova zajedno s mjestima (za prilagodbu prikaza).
    public static func contentBounds(_ tables: [Record]) -> Bounds? {
        if tables.isEmpty { return nil }
        var x1 = Double.infinity, y1 = Double.infinity
        var x2 = -Double.infinity, y2 = -Double.infinity
        for t in tables {
            let d = t.string("shape") == "round" ? Size(w: 90, h: 90) : dims(t)
            let rotation = t.number("rotation") ?? 0
            let turned = ((rotation.truncatingRemainder(dividingBy: 180)) + 180).truncatingRemainder(dividingBy: 180) == 90
            let hw = (turned ? d.h : d.w) / 2 + 30
            let hh = (turned ? d.w : d.h) / 2 + 30
            let x = t.number("x") ?? 0, y = t.number("y") ?? 0
            x1 = min(x1, x - hw); x2 = max(x2, x + hw)
            y1 = min(y1, y - hh); y2 = max(y2, y + hh)
        }
        return Bounds(x1: x1, y1: y1, x2: x2, y2: y2)
    }
}
