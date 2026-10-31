import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            GuestsView()
                .tabItem { Label("Gosti", systemImage: "person.2") }
            HallView()
                .tabItem { Label("Sala", systemImage: "square.grid.3x3") }
            SeatingView()
                .tabItem { Label("Raspored", systemImage: "list.bullet.rectangle") }
        }
    }
}
