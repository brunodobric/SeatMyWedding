import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard, guests, hall, seating
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dashboard: return String(localized: "Pregled")
        case .guests: return String(localized: "Gosti")
        case .hall: return String(localized: "Sala")
        case .seating: return String(localized: "Raspored")
        }
    }
    var icon: String {
        switch self {
        case .dashboard: return "heart.text.square"
        case .guests: return "person.2"
        case .hall: return "square.grid.3x3"
        case .seating: return "list.bullet.rectangle"
        }
    }
}

/// Standardni TabView: sustav sam postavlja traku (dolje na uskom zaslonu, sa strane na
/// vanjskom zaslonu iPhone Duoa) i pretvara je u bočni izbornik na širokom zaslonu.
/// Odabrani dio ostaje isti kad se zaslon sklopi ili otvori.
struct RootView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// Odabrani dio pamti se po prozoru (iPad može imati više prozora i vraća ih nakon gašenja).
    @SceneStorage("section") private var section: AppSection = .dashboard
    /// Pogled na salu zajednički za tabove Sala i Raspored u širokom prikazu.
    @State private var hallCamera = HallCamera()

    private var wide: Bool { sizeClass == .regular }

    /// Na širokom zaslonu su Gosti i Sala jedan tab (gosti lijevo, sala desno).
    private var sections: [AppSection] {
        wide ? AppSection.allCases.filter { $0 != .guests } : AppSection.allCases
    }

    /// Odabir koji se vidi: Gosti u širokom prikazu otvaraju spojeni tab Sala.
    private var selection: Binding<AppSection> {
        Binding(get: { wide && section == .guests ? .hall : section }, set: { section = $0 })
    }

    @ViewBuilder
    private func content(_ s: AppSection) -> some View {
        switch s {
        case .dashboard: DashboardView()
        case .guests: GuestsView()
        case .hall:
            if wide {
                ListBesideHall(camera: hallCamera) { GuestsView() } narrow: { HallView(camera: hallCamera) }
            } else {
                HallView()
            }
        case .seating:
            ListBesideHall(camera: hallCamera) { SeatingView() } narrow: { SeatingView() }
        }
    }

    var body: some View {
        if store.lockedByNewerVersion {
            ContentUnavailableView {
                Label("Ažuriraj aplikaciju", systemImage: "arrow.down.app")
            } description: {
                Text("Podaci su spremljeni novijom verzijom SeatMyWedding. Ništa nije obrisano: nakon ažuriranja sve će biti na mjestu.")
            }
        } else {
            main
        }
    }

    private var main: some View {
        tabs
            .overlay(alignment: .bottom) {
                if let toast = store.toast {
                    ToastBar(toast: toast)
                        .padding(.bottom, sizeClass == .regular ? 16 : 64)
                        .padding(.horizontal, 16)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: store.toast?.id)
            .onAppear {
                if let error = store.loadError { store.show(error, isError: true) }
            }
    }

    @ViewBuilder
    private var tabs: some View {
        if #available(iOS 18.0, *) {
            TabView(selection: selection) {
                ForEach(sections) { s in
                    Tab(s.title, systemImage: s.icon, value: s) { content(s) }
                }
            }
            .tabViewStyle(.sidebarAdaptable)
        } else {
            TabView(selection: selection) {
                ForEach(sections) { s in
                    content(s)
                        .tabItem { Label(s.title, systemImage: s.icon) }
                        .tag(s)
                }
            }
        }
    }
}

/// Široki zaslon: popis lijevo, sala desno. Tabovi Sala (gosti) i Raspored (stolovi) dijele
/// isti pogled na salu i istu širinu lijevog stupca, pa se pri promjeni taba mijenja samo popis.
private struct ListBesideHall<Left: View, Narrow: View>: View {
    let camera: HallCamera
    @ViewBuilder let list: Left
    @ViewBuilder let narrow: Narrow
    @State private var width: CGFloat = 0

    var body: some View {
        Group {
            if width >= 500 {
                HStack(spacing: 0) {
                    list
                        .frame(width: max(260, min(width * 0.36, 400)))
                    Divider()
                    HallView(besideList: true, camera: camera)
                }
            } else {
                narrow
            }
        }
        .measureWidth($width)
    }
}

private extension View {
    /// Širina se mjeri u pozadini (ne obavijanjem sadržaja u GeometryReader), da ugniježđeni
    /// prikazi zadrže svoja sigurna područja i ne idu pod sistemske kontrole.
    func measureWidth(_ width: Binding<CGFloat>) -> some View {
        background(
            GeometryReader { g in
                Color.clear
                    .onAppear { width.wrappedValue = g.size.width }
                    .onChange(of: g.size.width) { _, new in width.wrappedValue = new }
            }
        )
    }
}

private struct ToastBar: View {
    @Environment(WeddingStore.self) private var store
    let toast: WeddingStore.Toast

    var body: some View {
        HStack(spacing: 12) {
            Text(toast.message)
                .font(Theme.ui(15))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let undo = toast.undo {
                Button("Poništi") {
                    undo()
                    store.dismissToast()
                }
                .font(Theme.uiBold(15))
                .foregroundStyle(Theme.gold)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(toast.isError ? Theme.error : Color(hex: 0x2B2622), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(radius: 6, y: 2)
    }
}
