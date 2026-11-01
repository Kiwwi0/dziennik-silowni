import SwiftUI
import Charts

struct MonthGroup: Identifiable {
    let title: String
    let sessions: [Session]
    var id: String { title }
}

struct HistoryView: View {
    @EnvironmentObject var store: Store
    @State private var mode = 0
    @State private var exId: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Widok", selection: $mode) {
                        Text("Treningi").tag(0)
                        Text("Postępy").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
                if store.sessions.isEmpty {
                    Section {
                        Text("Jeszcze pusto. Po zapisaniu pierwszego treningu zobaczysz tu jego przebieg, a w widoku Postępy wykresy ciężarów dla każdego ćwiczenia.")
                            .foregroundStyle(.secondary)
                    }
                } else if mode == 0 {
                    ForEach(months) { m in
                        Section(m.title) {
                            ForEach(m.sessions) { s in
                                NavigationLink(value: s.id) { SessionRow(session: s) }
                            }
                        }
                    }
                } else {
                    ProgressSections(exId: $exId)
                }
            }
            .navigationTitle("Historia")
            .navigationDestination(for: String.self) { SessionDetailView(sessionId: $0) }
        }
    }

    private var months: [MonthGroup] {
        var out: [MonthGroup] = []
        var current = ""
        var bucket: [Session] = []
        for s in store.sessions {
            let m = fmtMonth(s.dateValue)
            if m != current {
                if !bucket.isEmpty { out.append(MonthGroup(title: current, sessions: bucket)) }
                current = m
                bucket = []
            }
            bucket.append(s)
        }
        if !bucket.isEmpty { out.append(MonthGroup(title: current, sessions: bucket)) }
        return out
    }
}

struct ChartPoint: Identifiable {
    let id = UUID()
    let date: Date
    let value: Double
    var detail: String = ""
}

struct ProgressSections: View {
    @EnvironmentObject var store: Store
    @Binding var exId: String?

    var body: some View {
        let ids = store.doneExerciseIds
        if let current = (exId.flatMap { ids.contains($0) ? $0 : nil }) ?? ids.first {
            let pts = store.progress(current)
            Section {
                Picker("Ćwiczenie", selection: Binding(get: { current }, set: { exId = $0 })) {
                    ForEach(ids, id: \.self) { id in Text(store.ex(id).name).tag(id) }
                }
                .pickerStyle(.navigationLink)
            }
            if let first = pts.first {
                let time = first.isTime
                let weighted = !time && pts.contains { $0.bestKg > 0 }
                Section {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        if time {
                            StatTile(label: "Najdłuższa seria", value: fmtN(pts.map { $0.bestSec }.max() ?? 0), unit: "s")
                            StatTile(label: "Ostatnio", value: fmtN(pts.last?.bestSec ?? 0), unit: "s")
                            StatTile(label: "Treningi", value: "\(pts.count)")
                            StatTile(label: "Łącznie", value: fmtClock(pts.reduce(0) { $0 + $1.totalSec }))
                        } else if weighted {
                            let best = pts.max(by: { $0.bestKg < $1.bestKg }) ?? first
                            StatTile(label: "Najcięższa seria", value: fmtN(best.bestKg), unit: "kg × \(fmtN(best.bestReps))")
                            StatTile(label: "Szacowany max (1RM)", value: fmtN(((pts.map { $0.e1rm }.max() ?? 0) * 2).rounded() / 2), unit: "kg")
                            StatTile(label: "Najwięcej powt.", value: fmtN(pts.map { $0.maxReps }.max() ?? 0))
                            StatTile(label: "Treningi", value: "\(pts.count)")
                        } else {
                            StatTile(label: "Najwięcej powt. w serii", value: fmtN(pts.map { $0.maxReps }.max() ?? 0))
                            StatTile(label: "Ostatnio łącznie", value: fmtN(pts.last?.reps ?? 0), unit: "powt.")
                            StatTile(label: "Treningi", value: "\(pts.count)")
                            StatTile(label: "Rekord łącznie", value: fmtN(pts.map { $0.reps }.max() ?? 0), unit: "powt.")
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                }
                Section {
                    if pts.count < 2 {
                        Text("Wykres pojawi się po drugim treningu z tym ćwiczeniem.").foregroundStyle(.secondary)
                    } else if time {
                        ProgressChart(title: "Najdłuższa seria (s)", unit: "s", bars: false,
                                      points: pts.map { ChartPoint(date: $0.date, value: $0.bestSec) })
                    } else if weighted {
                        ProgressChart(title: "Najcięższa seria (kg)", unit: "kg", bars: false,
                                      points: pts.map { ChartPoint(date: $0.date, value: $0.bestKg, detail: "× \(fmtN($0.bestReps)) powt.") })
                        ProgressChart(title: "Objętość: kg × powtórzenia", unit: "kg", bars: true,
                                      points: pts.map { ChartPoint(date: $0.date, value: $0.volume.rounded()) })
                    } else {
                        ProgressChart(title: "Suma powtórzeń na treningu", unit: "powt.", bars: true,
                                      points: pts.map { ChartPoint(date: $0.date, value: $0.reps) })
                    }
                }
                Section("Ostatnie treningi") {
                    ForEach(Array(pts.reversed().prefix(12))) { p in
                        HStack(alignment: .firstTextBaseline) {
                            Text(fmtDay(p.date)).frame(width: 64, alignment: .leading)
                            Text(p.sets.map { fmtSet($0, time: time) }.joined(separator: ", "))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 8)
                            Text(time ? fmtClock(p.totalSec) : (weighted ? fmtN(p.volume.rounded()) : fmtN(p.reps)))
                                .font(.subheadline.weight(.semibold))
                        }
                        .monospacedDigit()
                    }
                }
            }
        }
    }
}

struct ProgressChart: View {
    let title: String
    let unit: String
    let bars: Bool
    let points: [ChartPoint]
    @State private var selected: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            Chart {
                ForEach(points) { p in
                    if bars {
                        BarMark(x: .value("Data", p.date, unit: .day), y: .value(unit, p.value), width: .fixed(14))
                            .foregroundStyle(Color.brand)
                            .cornerRadius(4)
                    } else {
                        LineMark(x: .value("Data", p.date), y: .value(unit, p.value))
                            .foregroundStyle(Color.brand)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        PointMark(x: .value("Data", p.date), y: .value(unit, p.value))
                            .foregroundStyle(Color.brand)
                            .symbolSize(60)
                    }
                }
                if let sp = selectedPoint {
                    RuleMark(x: .value("Data", sp.date))
                        .foregroundStyle(Color.secondary.opacity(0.5))
                        .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            VStack(spacing: 2) {
                                Text("\(fmtN(sp.value)) \(unit)").font(.caption.weight(.bold))
                                if !sp.detail.isEmpty { Text(sp.detail).font(.caption2) }
                                Text(fmtDayLong(sp.date)).font(.caption2).foregroundStyle(.secondary)
                            }
                            .monospacedDigit()
                            .padding(6)
                            .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(uiColor: .separator), lineWidth: 0.5))
                        }
                }
            }
            .chartXSelection(value: $selected)
            .chartYScale(domain: .automatic(includesZero: bars))
            .frame(height: 210)
        }
        .padding(.vertical, 6)
    }

    private var selectedPoint: ChartPoint? {
        guard let s = selected else { return nil }
        return points.min(by: { abs($0.date.timeIntervalSince(s)) < abs($1.date.timeIntervalSince(s)) })
    }
}

struct SessionDetailView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let sessionId: String
    @State private var confirmDelete = false

    var body: some View {
        Group {
            if let s = store.sessions.first(where: { $0.id == sessionId }) {
                List {
                    Section {
                        Text(s.dateValue.formatted(.dateTime.weekday(.wide).day().month(.wide).year().locale(PL)))
                            .foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            StatTile(label: "Czas", value: fmtDur(s.dur))
                            StatTile(label: "Serie", value: "\(s.setCount)")
                            StatTile(label: "Objętość", value: fmtN(s.volume.rounded()), unit: "kg")
                            StatTile(label: "Ćwiczenia", value: "\(s.ex.count)")
                        }
                    }
                    ForEach(s.ex) { e in
                        Section {
                            HStack(spacing: 12) {
                                Thumb(exId: e.exId)
                                Text(store.ex(e.exId).name == "Usunięte ćwiczenie" ? e.name : store.ex(e.exId).name).font(.headline)
                            }
                            Text(e.sets.map { fmtSet($0, time: e.isTime) }.joined(separator: "   "))
                                .monospacedDigit()
                        }
                    }
                    Section {
                        Button("Usuń trening", role: .destructive) { confirmDelete = true }
                    }
                }
                .navigationTitle(s.dayName)
                .navigationBarTitleDisplayMode(.inline)
            } else {
                Text("Ten trening został usunięty.").foregroundStyle(.secondary)
            }
        }
        .confirmationDialog("Usunąć trening z historii?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) {
                let id = sessionId
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { store.deleteSession(id) }
            }
        } message: {
            Text("Tej operacji nie można cofnąć.")
        }
    }
}
