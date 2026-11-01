import SwiftUI

struct WorkoutView: View {
    @EnvironmentObject var store: Store
    @State private var showFinish = false
    @State private var showPicker = false
    @State private var infoId: String?

    var body: some View {
        NavigationStack {
            Group {
                if let a = store.active {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(a.ex) { x in
                                    WorkoutCard(key: x.id, isCurrent: store.currentKey == x.id, onInfo: { infoId = x.exId })
                                        .id(x.id)
                                }
                                Button { showPicker = true } label: {
                                    Label("Dodaj ćwiczenie", systemImage: "plus").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.large)
                            }
                            .padding(16)
                            .padding(.bottom, 12)
                        }
                        .scrollDismissesKeyboard(.interactively)
                        .background(Color(uiColor: .systemGroupedBackground))
                        .onChange(of: store.scrollTarget) { _, key in
                            guard let key else { return }
                            withAnimation(.easeInOut) { proxy.scrollTo(key, anchor: .top) }
                            store.scrollTarget = nil
                        }
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) { TimerBar() }
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { store.showWorkout = false } label: { Image(systemName: "chevron.down") }
                                .accessibilityLabel("Zwiń trening")
                        }
                        ToolbarItem(placement: .principal) {
                            VStack(spacing: 0) {
                                Text(a.dayName).font(.headline).lineLimit(1)
                                ElapsedText(start: a.startedAt).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Zakończ") { showFinish = true }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .keyboardDone()
                } else {
                    Color.clear
                }
            }
            .sheet(isPresented: $showFinish) {
                FinishView().environmentObject(store).presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showPicker) {
                ExercisePickerView(target: .workout).environmentObject(store)
            }
            .navigationDestination(item: $infoId) { id in ExerciseDetailView(exId: id, showAdd: false) }
            .alert("Wszystkie serie zrobione", isPresented: $store.allDoneMessage) {
                Button("Zakończ trening") { showFinish = true }
                Button("Jeszcze nie", role: .cancel) {}
            } message: {
                Text("Zakończ trening, żeby zapisać go w historii.")
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

struct WorkoutCard: View {
    @EnvironmentObject var store: Store
    let key: String
    let isCurrent: Bool
    let onInfo: () -> Void
    @State private var confirmRemove = false

    var body: some View {
        let x = store.wexBinding(key)
        let exercise = store.ex(x.wrappedValue.exId)
        VStack(alignment: .leading, spacing: 10) {
            WorkoutCardHeader(exercise: exercise, wex: x.wrappedValue, onInfo: onInfo,
                              onUp: { store.moveEx(key, by: -1) }, onDown: { store.moveEx(key, by: 1) },
                              onRemove: { confirmRemove = true })
            if let last = store.lastFor(exercise.id) {
                Text("Ostatnio (\(fmtDay(last.date))): " + last.sets.map { fmtSet($0, time: last.isTime) }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            SetsHeader(isTime: x.wrappedValue.isTime)
            ForEach(Array(x.wrappedValue.sets.enumerated()), id: \.element.id) { index, set in
                WorkoutSetRow(
                    number: index + 1,
                    set: store.wsetBinding(key: key, setId: set.id),
                    isTime: x.wrappedValue.isTime,
                    isRunning: isRunning(set.id),
                    onCheck: { store.toggleSet(key: key, setId: set.id) },
                    onStart: { store.startWork(key: key, setId: set.id) },
                    onStop: { store.stopWork() }
                )
            }
            if exercise.equipment == "Sztanga" {
                PlatesView(kg: currentKg(x.wrappedValue), bar: store.state.settings.bar)
            }
            HStack(spacing: 8) {
                Button { store.addSet(key) } label: { Label("Seria", systemImage: "plus") }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Button("Usuń serię") { store.removeSet(key) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(x.wrappedValue.sets.count <= 1)
                Spacer(minLength: 4)
                RestAdjuster(seconds: x.wrappedValue.rest,
                             minus: { store.adjustRest(key, by: -15) },
                             plus: { store.adjustRest(key, by: 15) })
            }
        }
        .padding(12)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isCurrent ? Color.brand : Color.clear, lineWidth: 2)
        )
        .confirmationDialog("Usunąć ćwiczenie z treningu?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { store.removeEx(key) }
        } message: {
            Text("\(exercise.name) zniknie z dzisiejszego treningu. Plan się nie zmieni.")
        }
    }

    private func isRunning(_ setId: String) -> Bool {
        guard let t = store.active?.timer else { return false }
        return t.kind == "work" && t.setId == setId && !t.fired
    }

    private func currentKg(_ x: WEx) -> Double? {
        (x.sets.first(where: { !$0.done }) ?? x.sets.last)?.kg
    }
}

struct WorkoutCardHeader: View {
    let exercise: Exercise
    let wex: WEx
    let onInfo: () -> Void
    let onUp: () -> Void
    let onDown: () -> Void
    let onRemove: () -> Void

    var body: some View {
        let done = wex.sets.filter { $0.done }.count
        HStack(spacing: 12) {
            Button(action: onInfo) { Thumb(exId: exercise.id) }
                .buttonStyle(.plain)
                .accessibilityLabel("Technika: \(exercise.name)")
            VStack(alignment: .leading, spacing: 2) {
                Button(action: onInfo) {
                    Text(exercise.name)
                        .font(.headline)
                        .foregroundStyle(done == wex.sets.count && !wex.sets.isEmpty ? Color.secondary : Color.primary)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                Text("\(done) z \(wex.sets.count) serii" + (wex.note.isEmpty ? "" : " · " + wex.note))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Menu {
                Button(action: onUp) { Label("Przesuń wyżej", systemImage: "arrow.up") }
                Button(action: onDown) { Label("Przesuń niżej", systemImage: "arrow.down") }
                Button(role: .destructive, action: onRemove) { Label("Usuń z treningu", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").frame(width: 36, height: 36).contentShape(Rectangle())
            }
            .accessibilityLabel("Opcje ćwiczenia")
        }
    }
}

struct SetsHeader: View {
    let isTime: Bool
    var body: some View {
        HStack(spacing: 6) {
            Text("#").frame(width: 20)
            Text("Cel").frame(maxWidth: .infinity, alignment: .leading)
            Text("kg").frame(width: 72)
            Text(isTime ? "Sek." : "Powt.").frame(width: 62)
            Color.clear.frame(width: 50, height: 1)
        }
        .font(.caption2.weight(.semibold))
        .textCase(.uppercase)
        .foregroundStyle(.secondary)
    }
}

struct WorkoutSetRow: View {
    let number: Int
    @Binding var set: WSet
    let isTime: Bool
    let isRunning: Bool
    let onCheck: () -> Void
    let onStart: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Text("\(number)").font(.headline).monospacedDigit().frame(width: 20)
            Text(target)
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            NumField(placeholder: "–", value: $set.kg)
                .modifier(SetField(done: set.done))
                .frame(width: 72)
                .accessibilityLabel("Seria \(number): ciężar w kilogramach")
            NumField(placeholder: isTime ? "s" : "powt.", value: isTime ? $set.sec : $set.reps, decimal: false)
                .modifier(SetField(done: set.done))
                .frame(width: 62)
                .accessibilityLabel(isTime ? "Seria \(number): czas w sekundach" : "Seria \(number): powtórzenia")
            actionButton.frame(width: 50, height: 44)
        }
    }

    private var target: String {
        if isTime {
            guard let s = set.tSec else { return "–" }
            return fmtN(s) + " s" + (set.tKg != nil ? " · " + fmtN(set.tKg) : "")
        }
        if set.tReps == nil && set.tKg == nil { return "–" }
        return (set.tKg != nil ? fmtN(set.tKg) + " × " : "") + (set.tReps != nil ? fmtN(set.tReps) : "–")
    }

    @ViewBuilder private var actionButton: some View {
        if set.done {
            Button(action: onCheck) {
                Image(systemName: "checkmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(Color.goodInk)
                    .background(Color.good, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Seria \(number) zrobiona. Stuknij, aby cofnąć.")
        } else if isTime && isRunning {
            Button(action: onStop) {
                Image(systemName: "stop.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(.white)
                    .background(Color.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Zakończ serię \(number)")
        } else {
            Button(action: isTime ? onStart : onCheck) {
                Image(systemName: isTime ? "play.fill" : "checkmark")
                    .font(.headline)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(.secondary)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color(uiColor: .separator), lineWidth: 1.5))
                    .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isTime ? "Start serii \(number)" : "Odhacz serię \(number)")
        }
    }
}

struct SetField: ViewModifier {
    let done: Bool
    func body(content: Content) -> some View {
        content
            .font(.system(size: 17, weight: .bold))
            .monospacedDigit()
            .padding(.vertical, 11)
            .background(done ? Color.goodSoft : Color.fieldFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct RestAdjuster: View {
    let seconds: Double
    let minus: () -> Void
    let plus: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text("Przerwa").font(.caption).foregroundStyle(.secondary)
            Button(action: minus) { Image(systemName: "minus") }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityLabel("Krótsza przerwa")
            Text(fmtRest(seconds)).font(.caption.weight(.semibold)).monospacedDigit().frame(minWidth: 52)
            Button(action: plus) { Image(systemName: "plus") }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityLabel("Dłuższa przerwa")
        }
    }
}

// MARK: - Pasek timera

struct TimerBar: View {
    @EnvironmentObject var store: Store

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { ctx in
            content(now: ctx.date)
        }
    }

    private enum Kind { case idle, rest, soon, over, work }

    @ViewBuilder private func content(now: Date) -> some View {
        let t = store.active?.timer
        let kind = kindFor(t, now: now)
        let remaining = t.map { $0.endsAt.timeIntervalSince(now) } ?? 0
        let fraction = t.map { max(0, min(1, 1 - remaining / max(1, $0.total))) } ?? 0
        let bg: Color = kind == .over ? Color.timerOver : Color.timerBG
        let fg: Color = kind == .over ? Color.timerOverInk : Color.timerFG
        VStack(spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label(kind, t))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(kind == .over ? fg : Color.timerMuted)
                        .lineLimit(1)
                    Text(timeText(kind, remaining))
                        .font(.system(size: 44, weight: .heavy))
                        .fontWidth(.expanded)
                        .monospacedDigit()
                        .foregroundStyle(kind == .soon ? Color.timerWarn : (kind == .idle ? Color.timerMuted : fg))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                Spacer(minLength: 0)
                buttons(kind, fg: fg, bg: bg)
            }
            ProgressView(value: fraction)
                .progressViewStyle(.linear)
                .tint(fg)
                .opacity(kind == .idle ? 0.3 : 1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background(bg.ignoresSafeArea(edges: .bottom))
        .foregroundStyle(fg)
        .accessibilityElement(children: .contain)
    }

    private func kindFor(_ t: RestTimer?, now: Date) -> Kind {
        guard let t else { return .idle }
        let rem = t.endsAt.timeIntervalSince(now)
        if t.kind == "work" { return .work }
        if rem <= 0 { return .over }
        return rem <= 10 ? .soon : .rest
    }

    private func label(_ kind: Kind, _ t: RestTimer?) -> String {
        switch kind {
        case .idle: return store.state.settings.autoRest ? "Przerwa ruszy po odhaczeniu serii" : "Przerwa: uruchom ręcznie"
        case .over: return "Koniec przerwy. Czas na serię!"
        default: return t?.label ?? ""
        }
    }

    private func timeText(_ kind: Kind, _ remaining: Double) -> String {
        switch kind {
        case .idle: return "0:00"
        case .over: return "+" + fmtClock(-remaining)
        default: return fmtClock(remaining.rounded(.up))
        }
    }

    @ViewBuilder private func buttons(_ kind: Kind, fg: Color, bg: Color) -> some View {
        HStack(spacing: 6) {
            switch kind {
            case .idle:
                TimerButton(title: "Start przerwy", main: true, fg: fg, bg: bg) { store.timerStart() }
            case .rest, .soon:
                TimerButton(title: "−15", main: false, fg: fg, bg: bg) { store.timerAdjust(-15) }
                    .accessibilityLabel("Skróć o 15 sekund")
                TimerButton(title: "+15", main: false, fg: fg, bg: bg) { store.timerAdjust(15) }
                    .accessibilityLabel("Wydłuż o 15 sekund")
                TimerButton(title: "Pomiń", main: true, fg: fg, bg: bg) { store.timerSkip() }
            case .work:
                TimerButton(title: "Zakończ serię", main: true, fg: fg, bg: bg) { store.stopWork() }
            case .over:
                TimerButton(title: "OK", main: true, fg: fg, bg: bg) { store.timerSkip() }
            }
        }
    }
}

struct TimerButton: View {
    let title: String
    let main: Bool
    let fg: Color
    let bg: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .padding(.horizontal, 12)
                .frame(minWidth: 50, minHeight: 46)
                .foregroundStyle(main ? bg : fg)
                .background(main ? fg : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(fg.opacity(main ? 0 : 0.45), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Zakończenie treningu

struct FinishView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var updatePlan = false
    @State private var confirmDiscard = false

    var body: some View {
        NavigationStack {
            Group {
                if let a = store.active {
                    let s = store.buildSession(a)
                    let linked = a.planId != nil && a.ex.contains { $0.itemId != nil }
                    List {
                        Section {
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                                StatTile(label: "Czas", value: fmtDur(s.dur))
                                StatTile(label: "Serie", value: "\(s.setCount)")
                                StatTile(label: "Objętość", value: fmtN(s.volume.rounded()), unit: "kg")
                                StatTile(label: "Ćwiczenia", value: "\(s.ex.count)")
                            }
                            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                        }
                        if s.setCount == 0 {
                            Text("Nie odhaczyłeś żadnej serii, więc nie ma czego zapisać.").foregroundStyle(.secondary)
                        }
                        if linked {
                            Section {
                                Toggle("Zapisz dzisiejsze ciężary i powtórzenia jako nowe wartości w planie", isOn: $updatePlan)
                            }
                        }
                        Section {
                            Button {
                                store.finish(updatePlan: updatePlan)
                                dismiss()
                            } label: {
                                Text("Zapisz trening").bold().frame(maxWidth: .infinity)
                            }
                            .disabled(s.setCount == 0)
                            Button("Odrzuć trening", role: .destructive) { confirmDiscard = true }
                                .frame(maxWidth: .infinity)
                        }
                    }
                } else {
                    Color.clear
                }
            }
            .navigationTitle("Zakończ trening")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Wróć") { dismiss() } }
            }
            .confirmationDialog("Odrzucić trening?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Odrzuć trening", role: .destructive) {
                    store.discard()
                    dismiss()
                }
            } message: {
                Text("Wpisane serie nie zostaną zapisane w historii.")
            }
        }
    }
}
