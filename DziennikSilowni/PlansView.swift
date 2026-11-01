import SwiftUI

enum PickTarget: Identifiable, Hashable {
    case day(planId: String, dayId: String)
    case workout

    var id: String {
        switch self {
        case .day(let p, let d): return p + "/" + d
        case .workout: return "workout"
        }
    }
}

struct PlansView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        NavigationStack(path: $store.plansPath) {
            List {
                if store.state.plans.isEmpty {
                    Section {
                        Text("Nie masz jeszcze planów. Utwórz własny albo dodaj przykładowy plan FBW (full body, 2 dni) i dopasuj go do siebie.")
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(store.state.plans) { p in
                    NavigationLink(value: p.id) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(p.name.isEmpty ? "Plan bez nazwy" : p.name).font(.headline)
                            Text(p.days.isEmpty ? "Brak dni treningowych" : p.days.map { $0.name.isEmpty ? "Dzień" : $0.name }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
                Section {
                    Button {
                        let id = store.addPlan()
                        store.plansPath.append(id)
                    } label: { Label("Nowy plan", systemImage: "plus") }
                    Button { store.addSample() } label: { Label("Dodaj przykładowy plan FBW", systemImage: "wand.and.stars") }
                }
            }
            .navigationTitle("Plany")
            .navigationDestination(for: String.self) { PlanEditorView(planId: $0) }
            .navigationDestination(for: ItemRef.self) { ItemEditorView(ref: $0) }
        }
    }
}

struct PlanEditorView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let planId: String
    @State private var pickTarget: PickTarget?
    @State private var confirmDeletePlan = false
    @State private var dayToDelete: String?

    var body: some View {
        let plan = store.planBinding(planId)
        List {
            Section("Nazwa planu") {
                TextField("np. FBW, Push Pull Legs", text: plan.name)
            }
            ForEach(plan.days) { $day in
                DaySection(planId: planId, day: $day,
                           isFirst: plan.wrappedValue.days.first?.id == day.id,
                           isLast: plan.wrappedValue.days.last?.id == day.id,
                           onAdd: { pickTarget = .day(planId: planId, dayId: day.id) },
                           onDelete: { dayToDelete = day.id })
            }
            Section {
                Button { store.addDay(planId) } label: { Label("Dodaj dzień treningowy", systemImage: "plus") }
            }
            Section {
                Button(role: .destructive) { confirmDeletePlan = true } label: { Label("Usuń plan", systemImage: "trash") }
            }
        }
        .navigationTitle(plan.wrappedValue.name.isEmpty ? "Nowy plan" : plan.wrappedValue.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { EditButton() }
        .keyboardDone()
        .sheet(item: $pickTarget) { target in
            ExercisePickerView(target: target).environmentObject(store)
        }
        .confirmationDialog("Usunąć plan?", isPresented: $confirmDeletePlan, titleVisibility: .visible) {
            Button("Usuń plan", role: .destructive) {
                let id = planId
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { store.deletePlan(id) }
            }
        } message: {
            Text("Plan zniknie razem ze wszystkimi dniami. Historia treningów zostanie.")
        }
        .confirmationDialog("Usunąć dzień?", isPresented: Binding(
            get: { dayToDelete != nil },
            set: { if !$0 { dayToDelete = nil } }
        ), titleVisibility: .visible) {
            Button("Usuń dzień", role: .destructive) {
                if let d = dayToDelete { store.deleteDay(planId: planId, dayId: d) }
                dayToDelete = nil
            }
        } message: {
            Text("Dzień i jego ćwiczenia zostaną usunięte z planu.")
        }
    }
}

struct DaySection: View {
    @EnvironmentObject var store: Store
    let planId: String
    @Binding var day: PlanDay
    let isFirst: Bool
    let isLast: Bool
    let onAdd: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Section {
            TextField("Nazwa dnia, np. Dzień A", text: $day.name).font(.headline)
            ForEach(day.items) { it in
                NavigationLink(value: ItemRef(planId: planId, dayId: day.id, itemId: it.id)) {
                    PlanItemRow(item: it)
                }
            }
            .onDelete { offsets in day.items.remove(atOffsets: offsets) }
            .onMove { from, to in day.items.move(fromOffsets: from, toOffset: to) }
            Button(action: onAdd) { Label("Dodaj ćwiczenia", systemImage: "plus.circle") }
        } header: {
            HStack {
                Text(day.name.isEmpty ? "Dzień" : day.name)
                Spacer()
                Menu {
                    Button { store.moveDay(planId: planId, dayId: day.id, by: -1) } label: { Label("Przesuń wyżej", systemImage: "arrow.up") }
                        .disabled(isFirst)
                    Button { store.moveDay(planId: planId, dayId: day.id, by: 1) } label: { Label("Przesuń niżej", systemImage: "arrow.down") }
                        .disabled(isLast)
                    Button(role: .destructive, action: onDelete) { Label("Usuń dzień", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").imageScale(.large)
                }
                .accessibilityLabel("Opcje dnia")
            }
        }
    }
}

struct PlanItemRow: View {
    @EnvironmentObject var store: Store
    let item: PlanItem

    var body: some View {
        HStack(spacing: 12) {
            Thumb(exId: item.exId)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.ex(item.exId).name).font(.subheadline.weight(.semibold))
                Text(store.setsSummary(item)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }
}

struct ItemEditorView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let ref: ItemRef

    var body: some View {
        let item = store.itemBinding(ref)
        let isTime = item.wrappedValue.isTime
        Form {
            Section {
                HStack(spacing: 12) {
                    Thumb(exId: item.wrappedValue.exId, width: 72)
                    Text(store.ex(item.wrappedValue.exId).name).font(.headline)
                }
                NavigationLink {
                    ExerciseDetailView(exId: item.wrappedValue.exId, showAdd: false)
                } label: {
                    Label("Technika wykonania", systemImage: "info.circle")
                }
            }
            Section("Rodzaj serii") {
                Picker("Rodzaj serii", selection: modeBinding(item)) {
                    Text("Powtórzenia").tag("reps")
                    Text("Czas").tag("time")
                }
                .pickerStyle(.segmented)
            }
            Section {
                HStack(spacing: 10) {
                    Text("Seria").frame(width: 44, alignment: .leading)
                    Text(isTime ? "Czas (s)" : "Powtórzenia").frame(maxWidth: .infinity)
                    Text("Ciężar (kg)").frame(maxWidth: .infinity)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                ForEach(item.sets) { $set in
                    HStack(spacing: 10) {
                        Text("\((item.wrappedValue.sets.firstIndex(where: { $0.id == set.id }) ?? 0) + 1).")
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .leading)
                        NumField(placeholder: isTime ? "s" : "powt.", value: isTime ? $set.sec : $set.reps, decimal: false)
                            .padding(.vertical, 8)
                            .background(Color.fieldFill, in: RoundedRectangle(cornerRadius: 8))
                        NumField(placeholder: "–", value: $set.kg)
                            .padding(.vertical, 8)
                            .background(Color.fieldFill, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .monospacedDigit()
                }
                .onDelete { offsets in
                    if item.wrappedValue.sets.count > offsets.count { item.wrappedValue.sets.remove(atOffsets: offsets) }
                }
                Button {
                    let last = item.wrappedValue.sets.last
                    item.wrappedValue.sets.append(PlanSet(reps: last?.reps ?? (isTime ? nil : 10), kg: last?.kg, sec: last?.sec ?? (isTime ? 30 : nil)))
                } label: { Label("Dodaj serię", systemImage: "plus") }
            } header: {
                Text("Serie")
            } footer: {
                Text("Puste pole ciężaru oznacza ćwiczenie z masą ciała. Serię usuniesz, przesuwając ją w lewo.")
            }
            Section("Przerwy") {
                Stepper(value: item.rest, in: 0...600, step: 15) {
                    HStack {
                        Text("Między seriami")
                        Spacer()
                        Text(fmtRest(item.wrappedValue.rest)).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
                Stepper(value: item.restAfter, in: 0...600, step: 15) {
                    HStack {
                        Text("Po ćwiczeniu")
                        Spacer()
                        Text(fmtRest(item.wrappedValue.restAfter)).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
            }
            Section("Notatka") {
                TextField("np. siedzisko na 4, czerwona guma", text: item.note, axis: .vertical)
            }
            Section {
                Button("Usuń z planu", role: .destructive) {
                    let r = ref
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { store.deleteItem(r) }
                }
            }
        }
        .navigationTitle("Ćwiczenie w planie")
        .navigationBarTitleDisplayMode(.inline)
        .keyboardDone()
    }

    private func modeBinding(_ item: Binding<PlanItem>) -> Binding<String> {
        Binding(
            get: { item.wrappedValue.mode },
            set: { newMode in
                var it = item.wrappedValue
                guard it.mode != newMode else { return }
                it.mode = newMode
                it.sets = it.sets.map { s in newMode == "time" ? PlanSet(kg: s.kg, sec: 30) : PlanSet(reps: 10, kg: s.kg) }
                item.wrappedValue = it
            }
        )
    }
}
