import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard, guests, hall, seating
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .guests: return "Gosti"
        case .hall: return "Sala"
        case .seating: return "Raspored"
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
    @State private var section: AppSection = .dashboard

    @ViewBuilder
    private func content(_ s: AppSection) -> some View {
        switch s {
        case .dashboard: DashboardView()
        case .guests: GuestsView()
        case .hall: HallView()
        case .seating: SeatingWithHall()
        }
    }

    var body: some View {
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
    }

    @ViewBuilder
    private var tabs: some View {
        if #available(iOS 18.0, *) {
            TabView(selection: $section) {
                ForEach(AppSection.allCases) { s in
                    Tab(s.title, systemImage: s.icon, value: s) { content(s) }
                }
            }
            .tabViewStyle(.sidebarAdaptable)
        } else {
            TabView(selection: $section) {
                ForEach(AppSection.allCases) { s in
                    content(s)
                        .tabItem { Label(s.title, systemImage: s.icon) }
                        .tag(s)
                }
            }
        }
    }
}

/// Raspored: na užem prostoru samo popis; kad ima mjesta (otvoreni iPhone Duo, iPad),
/// popis stolova i tlocrt jedno uz drugo, s istim stanjem i funkcijama.
private struct SeatingWithHall: View {
    @State private var width: CGFloat = 0

    var body: some View {
        // Širina se mjeri u pozadini (ne obavijanjem sadržaja u GeometryReader), da ugniježđeni
        // prikazi zadrže svoja sigurna područja i ne idu pod sistemske kontrole.
        Group {
            if width >= 820 {
                HStack(spacing: 0) {
                    SeatingView()
                        .frame(width: min(width * 0.4, 420))
                    Divider()
                    HallView()
                }
            } else {
                SeatingView()
            }
        }
        .background(
            GeometryReader { g in
                Color.clear
                    .onAppear { width = g.size.width }
                    .onChange(of: g.size.width) { _, new in width = new }
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
        .background(toast.isError ? Theme.error : Theme.ink, in: RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 6, y: 2)
    }
}
