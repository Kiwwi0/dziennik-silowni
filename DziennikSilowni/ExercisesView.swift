import SwiftUI

struct ExercisesView: View {
    @EnvironmentObject var store: Store
    @State private var query = ""
    @State private var group: String? = nil
    @State private var equipment: String? = nil
    @State private var showCustom = false

    var body: some View {
        NavigationStack {
            let groups = store.grouped(store.filtered(query: query, group: group, equipment: equipment))
            List {
                Section {
                    GroupChips(selected: $group)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if groups.isEmpty {
                    Text("Brak ćwiczeń pasujących do wyszukiwania.").foregroundStyle(.secondary)
                }
                ForEach(groups) { g in
                    Section {
                        ForEach(g.items) { e in
                            NavigationLink(value: e.id) { ExerciseRow(exercise: e) }
                        }
                    } header: {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(g.name)
                                .font(.system(size: 20, weight: .heavy))
                                .fontWidth(.condensed)
                                .foregroundStyle(.primary)
                            Text("\(g.items.count)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Szukaj, np. wiosłowanie, sztanga")
            .navigationTitle("Ćwiczenia")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Sprzęt", selection: $equipment) {
                            Text("Każdy sprzęt").tag(String?.none)
                            ForEach(EQUIPS, id: \.self) { q in Text(q).tag(String?.some(q)) }
                        }
                    } label: {
                        Label(equipment ?? "Sprzęt", systemImage: equipment == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showCustom = true } label: { Label("Własne", systemImage: "plus") }
                }
            }
            .navigationDestination(for: String.self) { ExerciseDetailView(exId: $0, showAdd: true) }
            .sheet(isPresented: $showCustom) {
                CustomExerciseForm(editId: nil, defaultGroup: group).environmentObject(store)
            }
        }
    }
}

struct ExerciseRow: View {
    let exercise: Exercise

    var body: some View {
        HStack(spacing: 12) {
            Thumb(exId: exercise.id)
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name).font(.subheadline.weight(.semibold))
                Text(meta).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var meta: String {
        ([exercise.equipment, exercise.primary.joined(separator: ", ")].filter { !$0.isEmpty }).joined(separator: " · ")
    }
}

struct ExerciseDetailView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let exId: String
    var showAdd: Bool = true
    @State private var showAddSheet = false
    @State private var showEdit = false
    @State private var confirmDelete = false

    var body: some View {
        let e = store.ex(exId)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ExerciseMedia(exId: e.id, name: e.name)
                Text(e.name)
                    .font(.system(size: 30, weight: .heavy))
                    .fontWidth(.condensed)
                    .textCase(.uppercase)
                    .fixedSize(horizontal: false, vertical: true)
                tags(e)
                if !e.primary.isEmpty {
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                        GridRow {
                            Text("Główne mięśnie").foregroundStyle(.secondary)
                            Text(e.primary.joined(separator: ", ")).bold()
                        }
                        if !e.secondary.isEmpty {
                            GridRow {
                                Text("Pomocnicze").foregroundStyle(.secondary)
                                Text(e.secondary.joined(separator: ", ")).bold()
                            }
                        }
                    }
                    .font(.subheadline)
                }
                if !e.steps.isEmpty {
                    sectionTitle("Technika")
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(e.steps.enumerated()), id: \.offset) { i, step in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("\(i + 1)")
                                    .font(.system(size: 24, weight: .heavy))
                                    .fontWidth(.condensed)
                                    .foregroundStyle(Color.brand)
                                    .frame(width: 22, alignment: .leading)
                                Text(step).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                if !e.tips.isEmpty {
                    sectionTitle("Na co uważać")
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(e.tips, id: \.self) { tip in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("•")
                                Text(tip).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                sectionTitle("Film")
                HStack {
                    Link(destination: youTube(e.name + " technika")) { Label("YouTube po polsku", systemImage: "play.rectangle") }
                        .buttonStyle(.bordered)
                    if let en = e.en, !en.isEmpty {
                        Link(destination: youTube(en + " proper form")) { Label("Po angielsku", systemImage: "play.rectangle") }
                            .buttonStyle(.bordered)
                    }
                }
                if e.isCustom {
                    HStack {
                        Button("Edytuj ćwiczenie") { showEdit = true }.buttonStyle(.bordered)
                        Button("Usuń", role: .destructive) { confirmDelete = true }.buttonStyle(.bordered)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(e.group)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if showAdd {
                    Button { showAddSheet = true } label: { Label("Dodaj do planu", systemImage: "plus") }
                }
            }
        }
        .sheet(isPresented: $showAddSheet) {
            AddToPlanView(exId: exId).environmentObject(store).presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showEdit) {
            CustomExerciseForm(editId: exId, defaultGroup: nil).environmentObject(store)
        }
        .confirmationDialog("Usunąć własne ćwiczenie?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                let id = exId
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { store.deleteCustom(id) }
            }
        } message: {
            Text("Zniknie też ze wszystkich planów. Historia treningów zostanie.")
        }
    }

    private func sectionTitle(_ s: String) -> some View {
        Text(s)
            .font(.system(size: 20, weight: .heavy))
            .fontWidth(.condensed)
            .textCase(.uppercase)
            .padding(.top, 4)
    }

    private func tags(_ e: Exercise) -> some View {
        let list = [e.equipment, e.level ?? "", e.isTime ? "na czas" : "", e.isCustom ? "własne" : ""].filter { !$0.isEmpty }
        return HStack(spacing: 6) {
            ForEach(list, id: \.self) { t in
                Text(t)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Color.fieldFill, in: Capsule())
            }
        }
    }
}

struct AddToPlanView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let exId: String

    var body: some View {
        NavigationStack {
            List {
                if store.state.plans.isEmpty {
                    Section {
                        Button {
                            let id = store.addPlan(name: "Mój plan", days: [PlanDay(name: "Dzień A", items: [store.newItem(exId)])])
                            dismiss()
                            store.tab = .plany
                            store.plansPath = NavigationPath([id])
                        } label: { Label("Utwórz plan z tym ćwiczeniem", systemImage: "plus") }
                    }
                }
                ForEach(store.state.plans) { p in
                    Section(p.name.isEmpty ? "Plan bez nazwy" : p.name) {
                        if p.days.isEmpty { Text("Brak dni w planie").foregroundStyle(.secondary) }
                        ForEach(p.days) { d in
                            Button {
                                store.addItems([exId], planId: p.id, dayId: d.id)
                                UINotificationFeedbackGenerator().notificationOccurred(.success)
                                dismiss()
                            } label: {
                                HStack {
                                    Text(d.name.isEmpty ? "Dzień" : d.name).foregroundStyle(.primary)
                                    Spacer()
                                    Image(systemName: "plus.circle")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Dodaj do planu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Anuluj") { dismiss() } }
            }
        }
    }
}

struct ExercisePickerView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let target: PickTarget
    @State private var query = ""
    @State private var group: String? = nil
    @State private var selected: [String] = []
    @State private var infoId: String?

    var body: some View {
        NavigationStack {
            let groups = store.grouped(store.filtered(query: query, group: group, equipment: nil))
            List {
                Section {
                    GroupChips(selected: $group)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                ForEach(groups) { g in
                    Section(g.name) {
                        ForEach(g.items) { e in
                            PickRow(exercise: e, isSelected: selected.contains(e.id),
                                    toggle: { toggle(e.id) }, info: { infoId = e.id })
                        }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Szukaj ćwiczenia")
            .navigationTitle(target == .workout ? "Dodaj do treningu" : "Dodaj ćwiczenia")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Anuluj") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(selected.isEmpty ? "Dodaj" : "Dodaj (\(selected.count))") { add() }
                        .bold()
                        .disabled(selected.isEmpty)
                }
            }
            .navigationDestination(item: $infoId) { id in ExerciseDetailView(exId: id, showAdd: false) }
        }
    }

    private func toggle(_ id: String) {
        if let i = selected.firstIndex(of: id) { selected.remove(at: i) } else { selected.append(id) }
    }

    private func add() {
        switch target {
        case .day(let planId, let dayId): store.addItems(selected, planId: planId, dayId: dayId)
        case .workout: store.addToWorkout(selected)
        }
        dismiss()
    }
}

struct PickRow: View {
    let exercise: Exercise
    let isSelected: Bool
    let toggle: () -> Void
    let info: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: toggle) {
                HStack(spacing: 12) {
                    Thumb(exId: exercise.id)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(exercise.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        Text(exercise.equipment).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(isSelected ? Color.brand : Color.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isSelected ? .isSelected : [])
            Button(action: info) { Image(systemName: "info.circle").font(.title3) }
                .buttonStyle(.borderless)
                .accessibilityLabel("Technika: \(exercise.name)")
        }
        .listRowBackground(isSelected ? Color.brand.opacity(0.12) : Color.card)
    }
}

struct CustomExerciseForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let editId: String?
    let defaultGroup: String?
    @State private var name = ""
    @State private var group = GROUPS[0]
    @State private var equipment = "Maszyna"
    @State private var mode = "reps"
    @State private var steps = ""
    @State private var tips = ""
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Nazwa") {
                    TextField("np. Wyciskanie na maszynie Hammer", text: $name)
                }
                Section {
                    Picker("Partia mięśniowa", selection: $group) {
                        ForEach(GROUPS, id: \.self) { g in Text(g).tag(g) }
                    }
                    Picker("Sprzęt", selection: $equipment) {
                        ForEach(EQUIPS, id: \.self) { q in Text(q).tag(q) }
                    }
                    Picker("Rodzaj serii", selection: $mode) {
                        Text("Powtórzenia").tag("reps")
                        Text("Czas").tag("time")
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    TextEditor(text: $steps).frame(minHeight: 120)
                } header: {
                    Text("Technika")
                } footer: {
                    Text("Każdy krok wpisz w nowej linii.")
                }
                Section("Na co uważać (opcjonalnie)") {
                    TextEditor(text: $tips).frame(minHeight: 80)
                }
            }
            .navigationTitle(editId == nil ? "Własne ćwiczenie" : "Edytuj ćwiczenie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Anuluj") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Zapisz") {
                        store.saveCustom(editId: editId, name: name, group: group, equipment: equipment, mode: mode, steps: steps, tips: tips)
                        dismiss()
                    }
                    .bold()
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                if let id = editId {
                    let e = store.ex(id)
                    name = e.name
                    group = GROUPS.contains(e.group) ? e.group : GROUPS[0]
                    equipment = EQUIPS.contains(e.equipment) ? e.equipment : "Inne"
                    mode = e.mode
                    steps = e.steps.joined(separator: "\n")
                    tips = e.tips.joined(separator: "\n")
                } else if let g = defaultGroup {
                    group = g
                }
            }
        }
    }
}
