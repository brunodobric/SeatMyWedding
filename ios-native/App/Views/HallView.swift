import SwiftUI
import SeatingCore

/// Tlocrt sale: stolovi i mjesta crtaju se u istim koordinatama kao na webu.
/// Pomicanje jednim prstom, zumiranje štipanjem ili gumbima.
struct HallView: View {
    @Environment(WeddingStore.self) private var store

    @State private var scale: CGFloat = 1
    @State private var origin: CGPoint = .zero
    @State private var baseScale: CGFloat = 1
    @State private var baseOrigin: CGPoint = .zero
    @State private var magnifying = false
    @State private var anchorWorld: CGPoint = .zero
    @State private var viewSize: CGSize = .zero
    @State private var fitted = false
    @State private var arranging = false
    @State private var openTable: TableRef?
    @State private var dragMode: DragMode?
    @State private var movingTable: String?
    @State private var moveDelta: CGSize = .zero

    private enum DragMode { case pan, table }

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                ZStack(alignment: .bottomTrailing) {
                    if store.tables.isEmpty {
                        ContentUnavailableView {
                            Label("Još nema stolova", systemImage: "square.grid.3x3")
                        } description: {
                            Text("Uvezi sigurnosnu kopiju na kartici Gosti. Slaganje sale dolazi uskoro.")
                        }
                    } else {
                        canvas
                        controls(size: geo.size)
                    }
                }
                .onAppear { viewSize = geo.size; fitIfNeeded() }
                .onChange(of: geo.size) { _, new in viewSize = new; fitIfNeeded() }
                .onChange(of: store.tables.count) { _, _ in fitted = false; fitIfNeeded() }
            }
            .background(Theme.background)
            .navigationTitle("Sala")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(arranging ? "Gotovo" : "Premjesti stolove") { arranging.toggle() }
                        .font(Theme.ui(15))
                        .disabled(store.tables.isEmpty)
                }
            }
            .sheet(item: $openTable) { ref in
                TableSheet(tableId: ref.id)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: Crtanje

    private var canvas: some View {
        let tables = store.tables
        let guests = store.guests
        return Canvas { ctx, _ in
            var world = ctx
            world.translateBy(x: origin.x, y: origin.y)
            world.scaleBy(x: scale, y: scale)
            for table in tables {
                let moving = table.id == movingTable
                drawTable(table, guests: guests, in: world,
                          offset: moving ? CGSize(width: moveDelta.width / scale, height: moveDelta.height / scale) : .zero,
                          highlighted: arranging)
            }
        }
        .onTapGesture { location in
            guard !arranging else { return }
            if let id = hitTable(at: location) { openTable = TableRef(id: id) }
        }
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { v in
                    guard !magnifying else { return }
                    if dragMode == nil {
                        if arranging, let id = hitTable(at: v.startLocation) {
                            dragMode = .table
                            movingTable = id
                        } else {
                            dragMode = .pan
                        }
                    }
                    switch dragMode {
                    case .table:
                        moveDelta = v.translation
                    default:
                        origin = CGPoint(x: baseOrigin.x + v.translation.width, y: baseOrigin.y + v.translation.height)
                    }
                }
                .onEnded { v in
                    if dragMode == .table, let id = movingTable,
                       let t = store.tables.first(where: { $0.id == id }) {
                        store.moveTable(id,
                                        x: (t.number("x") ?? 0) + v.translation.width / scale,
                                        y: (t.number("y") ?? 0) + v.translation.height / scale)
                    } else if !magnifying {
                        baseOrigin = origin
                    }
                    movingTable = nil
                    moveDelta = .zero
                    dragMode = nil
                }
        )
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { v in
                    if !magnifying {
                        magnifying = true
                        anchorWorld = CGPoint(
                            x: (v.startLocation.x - baseOrigin.x) / baseScale,
                            y: (v.startLocation.y - baseOrigin.y) / baseScale)
                    }
                    let s = min(max(baseScale * v.magnification, 0.15), 4)
                    scale = s
                    origin = CGPoint(x: v.startLocation.x - anchorWorld.x * s, y: v.startLocation.y - anchorWorld.y * s)
                }
                .onEnded { _ in
                    baseScale = scale
                    baseOrigin = origin
                    magnifying = false
                }
        )
    }

    /// Stol (ili njegovo mjesto) ispod točke na ekranu.
    private func hitTable(at point: CGPoint) -> String? {
        let wx = (point.x - origin.x) / scale
        let wy = (point.y - origin.y) / scale
        for table in store.tables.reversed() {
            let rel = Point(x: wx - (table.number("x") ?? 0), y: wy - (table.number("y") ?? 0))
            let a = -(table.number("rotation") ?? 0) * .pi / 180
            let local = Point(x: rel.x * cos(a) - rel.y * sin(a), y: rel.x * sin(a) + rel.y * cos(a))
            let d = FloorGeometry.dims(table)
            let onTable = table.string("shape") == "round"
                ? hypot(local.x, local.y) <= FloorGeometry.roundRadius
                : abs(local.x) <= d.w / 2 && abs(local.y) <= d.h / 2
            if onTable { return table.id }
            for seat in FloorGeometry.seatPositions(table) where hypot(local.x - seat.x, local.y - seat.y) <= 14 {
                return table.id
            }
        }
        return nil
    }

    private func drawTable(_ table: Record, guests: [Record], in world: GraphicsContext, offset: CGSize, highlighted: Bool) {
        let tx = table.number("x") ?? 0
        let ty = table.number("y") ?? 0
        let rotation = table.number("rotation") ?? 0
        let angle = rotation * .pi / 180
        let seatsTotal = table.number("seats") ?? 0
        let tableId = table.id ?? ""
        let seated = guests.filter { $0.string("tableId") == tableId }
        let full = Double(seated.count) >= seatsTotal && seatsTotal > 0

        var local = world
        local.translateBy(x: tx + offset.width, y: ty + offset.height)
        var turned = local
        turned.rotate(by: .radians(angle))

        // Stol
        let dims = FloorGeometry.dims(table)
        let isRound = table.string("shape") == "round"
        let shape: Path = isRound
            ? Path(ellipseIn: CGRect(x: -FloorGeometry.roundRadius, y: -FloorGeometry.roundRadius,
                                     width: FloorGeometry.roundRadius * 2, height: FloorGeometry.roundRadius * 2))
            : Path(roundedRect: CGRect(x: -dims.w / 2, y: -dims.h / 2, width: dims.w, height: dims.h), cornerRadius: 6)
        turned.fill(shape, with: .color(full ? Color(hex: 0xF3F8F1) : .white))
        turned.stroke(shape, with: .color(highlighted ? Theme.gold : Theme.goldDeep), lineWidth: highlighted ? 2.5 : 1.5)

        // Tekst ostaje uspravan i kad je stol zakrenut.
        func upright(_ p: Point) -> CGPoint {
            CGPoint(x: p.x * cos(angle) - p.y * sin(angle), y: p.x * sin(angle) + p.y * cos(angle))
        }
        let labelY = isRound ? -10.0 : -7.0
        local.draw(
            Text(verbatim: table.string("name") ?? "").font(Theme.fixed(13.5, weight: .semibold)).foregroundStyle(Theme.bronze),
            at: upright(Point(x: 0, y: labelY)), anchor: .center)
        local.draw(
            Text(verbatim: "\(seated.count)/\(Int(seatsTotal))")
                .font(Theme.fixed(11)).foregroundStyle(full ? Theme.success : Theme.muted),
            at: upright(Point(x: 0, y: labelY + 16)), anchor: .center)

        // Mjesta
        var bySeat: [Int: Record] = [:]
        for g in seated { if let i = g.integer("seatIndex") { bySeat[Int(i)] = g } }
        for (i, pos) in FloorGeometry.seatPositions(table).enumerated() {
            let p = upright(pos)
            let guest = bySeat[i]
            let color = Self.seatColor(guest)
            let circle = Path(ellipseIn: CGRect(x: p.x - 10, y: p.y - 10, width: 20, height: 20))
            local.fill(circle, with: .color(color ?? Theme.champagne))
            local.stroke(circle, with: .color(color ?? Theme.border), lineWidth: 1.5)
            if let guest = guest {
                local.draw(
                    Text(verbatim: Self.initials(guest.string("name") ?? "")).font(Theme.fixed(7, weight: .semibold)).foregroundStyle(.white),
                    at: p, anchor: .center)
            }
        }
    }

    static func seatColor(_ guest: Record?) -> Color? {
        guard let guest = guest else { return nil }
        let party = guest.string("party")
        if party == "couple" { return Theme.seatCouple }
        return guest.isTruthy("party") ? Theme.seatKumovi : Theme.gold
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(whereSeparator: { $0.isWhitespace }).compactMap { $0.first }
        let s = String(letters.prefix(2)).uppercased()
        return s.isEmpty ? "?" : s
    }

    // MARK: Prikaz

    private func controls(size: CGSize) -> some View {
        VStack(spacing: 10) {
            roundButton("plus") { zoom(by: 1.25, size: size) }
            roundButton("minus") { zoom(by: 0.8, size: size) }
            roundButton("arrow.up.left.and.arrow.down.right") { fit(size: size) }
        }
        .padding(16)
    }

    private func roundButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 40, height: 40)
                .foregroundStyle(Theme.goldDeep)
                .background(.white, in: Circle())
                .overlay(Circle().stroke(Theme.border))
        }
    }

    private func zoom(by factor: CGFloat, size: CGSize) {
        let s = min(max(scale * factor, 0.15), 4)
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let wx = (center.x - origin.x) / scale, wy = (center.y - origin.y) / scale
        scale = s
        origin = CGPoint(x: center.x - wx * s, y: center.y - wy * s)
        baseScale = scale
        baseOrigin = origin
    }

    private func fitIfNeeded() {
        guard !fitted, viewSize.width > 0, !store.tables.isEmpty else { return }
        fitted = true
        fit(size: viewSize)
    }

    /// Prilagodi prikaz svim stolovima (kao fitToContent na webu).
    private func fit(size: CGSize) {
        guard let b = FloorGeometry.contentBounds(store.tables), size.width > 0, size.height > 0 else { return }
        let pad = 30.0
        let w = max(b.x2 - b.x1 + pad * 2, 420)
        let h = max(b.y2 - b.y1 + pad * 2, 300)
        let s = min(size.width / w, size.height / h)
        scale = s
        origin = CGPoint(
            x: size.width / 2 - (b.x1 + b.x2) / 2 * s,
            y: size.height / 2 - (b.y1 + b.y2) / 2 * s)
        baseScale = scale
        baseOrigin = origin
    }
}
