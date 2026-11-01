import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: Store
    @State private var showSettings = false
    @State private var pendingStart: StartRequest?

    struct StartRequest: Identifiable {
        let id = UUID()
        let planId: String
        let dayId: String
    }

    var body: some View {
        NavigationStack {
            List {
                if let a = store.active {
                    Section {
                        Button { store.showWorkout = true } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 4) {
                                        Text("Trening w toku ·")
                                        ElapsedText(start: a.startedAt)
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    Text(a.dayName).font(.headline).foregroundStyle(.primary)
                                }
                                Spacer()
                                Text("Wróć").bold()
                            }
                        }
                    }
                }

                if store.state.plans.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Zacznij od planu")
                                .font(.system(size: 26, weight: .heavy))
                                .fontWidth(.condensed)
                            Text("Plan składa się z dni treningowych, np. Dzień A i Dzień B. Do każdego dnia dodajesz ćwiczenia z bazy, liczbę serii, powtórzeń i ciężar. Potem tutaj uruchamiasz trening z timerem przerw.")
                                .foregroundStyle(.secondary)
                            Button {
                                let id = store.addPlan()
                                store.tab = .plany
                                store.plansPath = NavigationPath([id])
                            } label: { Label("Utwórz plan", systemImage: "plus") }
                                .buttonStyle(.borderedProminent)
                            Button { store.addSample() } label: { Text("Wczytaj przykładowy plan FBW") }
                                .buttonStyle(.bordered)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    ForEach(store.state.plans) { plan in
                        PlanStartSection(plan: plan) { day in requestStart(plan, day) }
                    }
                }

                if let last = store.sessions.first {
                    Section {
                        NavigationLink(value: last.id) { SessionRow(session: last) }
                        Text("W tym tygodniu: \(store.sessionsThisWeek) \(pl(store.sessionsThisWeek, "trening", "treningi", "treningów"))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } header: { Text("Ostatnio") }
                }
            }
            .navigationTitle("Trening")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ustawienia")
                }
            }
            .navigationDestination(for: String.self) { SessionDetailView(sessionId: $0) }
            .sheet(isPresented: $showSettings) { SettingsView().environmentObject(store) }
            .alert("Masz trening w toku", isPresented: Binding(
                get: { pendingStart != nil },
                set: { if !$0 { pendingStart = nil } }
            ), presenting: pendingStart) { req in
                Button("Odrzuć i zacznij nowy", role: .destructive) { store.start(planId: req.planId, dayId: req.dayId) }
                Button("Anuluj", role: .cancel) {}
            } message: { _ in
                Text("Poprzedni trening nie został zapisany. Jeśli zaczniesz nowy, tamten przepadnie.")
            }
        }
    }

    private func requestStart(_ plan: Plan, _ day: PlanDay) {
        if store.active != nil {
            pendingStart = StartRequest(planId: plan.id, dayId: day.id)
        } else {
            store.start(planId: plan.id, dayId: day.id)
        }
    }
}

struct PlanStartSection: View {
    @EnvironmentObject var store: Store
    let plan: Plan
    let onStart: (PlanDay) -> Void

    var body: some View {
        Section {
            if plan.days.isEmpty {
                Text("Ten plan nie ma jeszcze dni treningowych.").foregroundStyle(.secondary)
            }
            ForEach(plan.days) { day in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(day.name.isEmpty ? "Dzień" : day.name).font(.headline)
                        Text(meta(day)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { onStart(day) } label: { Label("Start", systemImage: "play.fill") }
                        .buttonStyle(.borderedProminent)
                        .disabled(day.items.isEmpty)
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text(plan.name.isEmpty ? "Plan bez nazwy" : plan.name)
                .font(.system(size: 20, weight: .heavy))
                .fontWidth(.condensed)
                .foregroundStyle(.primary)
        }
    }

    private func meta(_ day: PlanDay) -> String {
        var s = "\(day.items.count) \(pl(day.items.count, "ćwiczenie", "ćwiczenia", "ćwiczeń"))"
        if let last = store.lastDone(planId: plan.id, dayId: day.id) { s += " · ostatnio " + relDay(last.dateValue) }
        return s
    }
}

struct SessionRow: View {
    let session: Session

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(session.dayName) · \(fmtDayLong(session.dateValue))").font(.headline)
                Text(meta).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer()
            if session.volume > 0 {
                Text("\(fmtN(session.volume.rounded())) kg").font(.subheadline.weight(.semibold)).monospacedDigit()
            }
        }
    }

    private var meta: String {
        var parts: [String] = []
        if !session.planName.isEmpty { parts.append(session.planName) }
        parts.append(fmtDur(session.dur))
        parts.append("\(session.setCount) \(pl(session.setCount, "seria", "serie", "serii"))")
        return parts.joined(separator: " · ")
    }
}
