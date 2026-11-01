import SwiftUI
import UIKit

@main
struct DziennikSilowniApp: App {
    @StateObject private var store = Store()

    init() {
        let large = UIFont.systemFont(ofSize: 34, weight: .heavy, width: .condensed)
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: large]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(.brand)
                .environment(\.locale, PL)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @Environment(\.scenePhase) private var phase

    var body: some View {
        TabView(selection: $store.tab) {
            HomeView()
                .tabItem { Label("Trening", systemImage: "dumbbell") }
                .tag(AppTab.trening)
            PlansView()
                .tabItem { Label("Plany", systemImage: "list.bullet.clipboard") }
                .tag(AppTab.plany)
            ExercisesView()
                .tabItem { Label("Ćwiczenia", systemImage: "book") }
                .tag(AppTab.cwiczenia)
            HistoryView()
                .tabItem { Label("Historia", systemImage: "chart.xyaxis.line") }
                .tag(AppTab.historia)
        }
        .fullScreenCover(isPresented: Binding(
            get: { store.active != nil && store.showWorkout },
            set: { if !$0 { store.showWorkout = false } }
        )) {
            WorkoutView()
                .environmentObject(store)
                .tint(.brand)
                .environment(\.locale, PL)
        }
        .onChange(of: phase) { _, newPhase in
            if newPhase == .active {
                store.refreshNotificationStatus()
                store.tick()
            } else {
                store.saveNow()
            }
        }
    }
}
