import SwiftUI
import Combine
import UserNotifications
import AudioToolbox

enum AppTab: Hashable { case trening, plany, cwiczenia, historia }

struct ItemRef: Hashable {
    let planId: String
    let dayId: String
    let itemId: String
}

struct ExGroup: Identifiable {
    let name: String
    let items: [Exercise]
    var id: String { name }
}

struct ProgressPoint: Identifiable {
    let id = UUID()
    let date: Date
    let isTime: Bool
    let bestKg: Double
    let bestReps: Double
    let bestSec: Double
    let e1rm: Double
    let volume: Double
    let reps: Double
    let maxReps: Double
    let totalSec: Double
    let sets: [SessionSet]
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }
}

final class Store: ObservableObject {
    @Published var state: AppState
    @Published var sessions: [Session]
    @Published var active: ActiveWorkout?
    @Published var showWorkout = false
    @Published var tab: AppTab = .trening
    @Published var plansPath = NavigationPath()
    @Published var scrollTarget: String?
    @Published var allDoneMessage = false
    @Published var notifStatus: UNAuthorizationStatus = .notDetermined

    let catalog: [Exercise]
    private let catalogMap: [String: Exercise]
    private let catalogOrder: [String: Int]
    private var bag = Set<AnyCancellable>()
    private let notificationDelegate = NotificationDelegate()

    init() {
        let cat = Store.loadCatalog()
        catalog = cat
        catalogMap = Dictionary(cat.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        catalogOrder = Dictionary(cat.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        state = Store.read(AppState.self, "state.json") ?? AppState()
        sessions = (Store.read([Session].self, "sessions.json") ?? []).sorted { $0.date > $1.date }
        active = Store.read(ActiveWorkout.self, "active.json")
        showWorkout = active != nil

        UNUserNotificationCenter.current().delegate = notificationDelegate
        $state.dropFirst()
            .debounce(for: .milliseconds(400), scheduler: RunLoop.main)
            .sink { Store.write($0, "state.json") }
            .store(in: &bag)
        $sessions.dropFirst()
            .sink { Store.write($0, "sessions.json") }
            .store(in: &bag)
        $active.dropFirst()
            .sink { a in
                if let a { Store.write(a, "active.json") } else { Store.remove("active.json") }
            }
            .store(in: &bag)
        Timer.publish(every: 0.5, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.tick() }
            .store(in: &bag)
        refreshNotificationStatus()
    }

    // MARK: Pliki

    private static var dir: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    static func read<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func write<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: dir.appendingPathComponent(name), options: .atomic)
    }

    static func remove(_ name: String) {
        try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
    }

    func saveNow() {
        Store.write(state, "state.json")
        Store.write(sessions, "sessions.json")
        if let a = active { Store.write(a, "active.json") }
    }

    static func loadCatalog() -> [Exercise] {
        guard let url = Bundle.main.url(forResource: "exercises", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Exercise].self, from: data)) ?? []
    }

    // MARK: Ćwiczenia

    func ex(_ id: String) -> Exercise {
        catalogMap[id] ?? state.custom.first(where: { $0.id == id })
            ?? Exercise(id: id, name: "Usunięte ćwiczenie", group: "", equipment: "")
    }

    func hasImage(_ id: String) -> Bool { catalogMap[id] != nil }

    var allExercises: [Exercise] { catalog + state.custom }

    private func order(_ e: Exercise) -> Int {
        if let k = catalogOrder[e.id] { return k }
        return 100_000 + (state.custom.firstIndex { $0.id == e.id } ?? 0)
    }

    func filtered(query: String, group: String?, equipment: String?) -> [Exercise] {
        let q = norm(query).trimmingCharacters(in: .whitespaces)
        return allExercises.filter { e in
            if let group, e.group != group { return false }
            if let equipment, e.equipment != equipment { return false }
            if q.isEmpty { return true }
            let hay = norm(([e.name, e.en ?? "", e.group, e.equipment] + e.primary).joined(separator: " "))
            return hay.contains(q)
        }
    }

    func grouped(_ list: [Exercise]) -> [ExGroup] {
        GROUPS.compactMap { g in
            let items = list.filter { $0.group == g }.sorted { order($0) < order($1) }
            return items.isEmpty ? nil : ExGroup(name: g, items: items)
        }
    }

    func saveCustom(editId: String?, name: String, group: String, equipment: String, mode: String, steps: String, tips: String) {
        let lines: (String) -> [String] = { text in
            text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if let editId, let i = state.custom.firstIndex(where: { $0.id == editId }) {
            state.custom[i].name = trimmed
            state.custom[i].group = group
            state.custom[i].equipment = equipment
            state.custom[i].mode = mode
            state.custom[i].steps = lines(steps)
            state.custom[i].tips = lines(tips)
        } else {
            state.custom.append(Exercise(id: "c_" + uid(), name: trimmed, group: group, equipment: equipment, mode: mode,
                                         level: "", steps: lines(steps), tips: lines(tips), custom: true))
        }
    }

    func deleteCustom(_ id: String) {
        state.custom.removeAll { $0.id == id }
        for p in state.plans.indices {
            for d in state.plans[p].days.indices {
                state.plans[p].days[d].items.removeAll { $0.exId == id }
            }
        }
    }

    // MARK: Historia

    func lastFor(_ exId: String) -> (date: Date, isTime: Bool, sets: [SessionSet])? {
        for s in sessions {
            if let x = s.ex.first(where: { $0.exId == exId }), !x.sets.isEmpty {
                return (s.dateValue, x.isTime, x.sets)
            }
        }
        return nil
    }

    func lastDone(planId: String, dayId: String) -> Session? {
        sessions.first { $0.planId == planId && $0.dayId == dayId }
    }

    var sessionsThisWeek: Int {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        guard let start = cal.dateInterval(of: .weekOfYear, for: Date())?.start else { return 0 }
        return sessions.filter { $0.dateValue >= start }.count
    }

    var doneExerciseIds: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for s in sessions {
            for x in s.ex where !seen.contains(x.exId) {
                seen.insert(x.exId)
                out.append(x.exId)
            }
        }
        return out.sorted { ex($0).name.localizedCompare(ex($1).name) == .orderedAscending }
    }

    func progress(_ exId: String) -> [ProgressPoint] {
        var out: [ProgressPoint] = []
        for s in sessions.reversed() {
            guard let x = s.ex.first(where: { $0.exId == exId }), !x.sets.isEmpty else { continue }
            var bestKg = -1.0, bestReps = 0.0, e1 = 0.0, vol = 0.0, reps = 0.0, maxReps = 0.0, bestSec = 0.0, totalSec = 0.0
            for t in x.sets {
                let kg = t.kg ?? 0, r = t.reps ?? 0, sec = t.sec ?? 0
                vol += kg * r
                reps += r
                maxReps = max(maxReps, r)
                bestSec = max(bestSec, sec)
                totalSec += sec
                if kg > bestKg || (kg == bestKg && r > bestReps) { bestKg = kg; bestReps = r }
                if kg > 0 && r > 0 { e1 = max(e1, kg * (1 + r / 30)) }
            }
            out.append(ProgressPoint(date: s.dateValue, isTime: x.isTime, bestKg: max(0, bestKg), bestReps: bestReps,
                                     bestSec: bestSec, e1rm: e1, volume: vol, reps: reps, maxReps: maxReps,
                                     totalSec: totalSec, sets: x.sets))
        }
        return out
    }

    func deleteSession(_ id: String) { sessions.removeAll { $0.id == id } }

    // MARK: Plany

    func pIndex(_ id: String) -> Int? { state.plans.firstIndex { $0.id == id } }

    func planBinding(_ id: String) -> Binding<Plan> {
        Binding(
            get: { self.state.plans.first(where: { $0.id == id }) ?? Plan(id: id, name: "", days: []) },
            set: { newValue in if let i = self.pIndex(id) { self.state.plans[i] = newValue } }
        )
    }

    func itemBinding(_ ref: ItemRef) -> Binding<PlanItem> {
        Binding(
            get: {
                self.state.plans.first(where: { $0.id == ref.planId })?
                    .days.first(where: { $0.id == ref.dayId })?
                    .items.first(where: { $0.id == ref.itemId }) ?? PlanItem(id: ref.itemId, exId: "")
            },
            set: { newValue in
                guard let p = self.pIndex(ref.planId),
                      let d = self.state.plans[p].days.firstIndex(where: { $0.id == ref.dayId }),
                      let i = self.state.plans[p].days[d].items.firstIndex(where: { $0.id == ref.itemId }) else { return }
                self.state.plans[p].days[d].items[i] = newValue
            }
        )
    }

    func newItem(_ exId: String) -> PlanItem {
        let t = ex(exId).isTime
        return PlanItem(exId: exId, mode: t ? "time" : "reps", rest: state.settings.restSet, restAfter: state.settings.restEx,
                        sets: (0..<3).map { _ in t ? PlanSet(sec: 30) : PlanSet(reps: 10) })
    }

    @discardableResult
    func addPlan(name: String = "", days: [PlanDay]? = nil) -> String {
        let p = Plan(name: name, days: days ?? [PlanDay(name: "Dzień A")])
        state.plans.append(p)
        return p.id
    }

    func addSample() {
        func item(_ id: String, _ n: Int, reps: Double? = nil, kg: Double? = nil, sec: Double? = nil) -> PlanItem {
            var it = newItem(id)
            it.sets = (0..<n).map { _ in sec != nil ? PlanSet(kg: kg, sec: sec) : PlanSet(reps: reps, kg: kg) }
            return it
        }
        let a = PlanDay(name: "Dzień A", items: [
            item("Barbell_Squat", 3, reps: 8, kg: 40),
            item("Barbell_Bench_Press_-_Medium_Grip", 3, reps: 8, kg: 40),
            item("Bent_Over_Barbell_Row", 3, reps: 10, kg: 30),
            item("Seated_Dumbbell_Press", 3, reps: 10, kg: 12),
            item("Plank", 3, sec: 45),
        ])
        let b = PlanDay(name: "Dzień B", items: [
            item("Barbell_Deadlift", 3, reps: 5, kg: 60),
            item("Incline_Dumbbell_Press", 3, reps: 10, kg: 16),
            item("Wide-Grip_Lat_Pulldown", 3, reps: 10, kg: 40),
            item("Dumbbell_Lunges", 3, reps: 10, kg: 10),
            item("Hanging_Leg_Raise", 3, reps: 12),
        ])
        state.plans.append(Plan(name: "FBW (przykład)", days: [a, b]))
    }

    func deletePlan(_ id: String) { state.plans.removeAll { $0.id == id } }

    func addDay(_ planId: String) {
        guard let p = pIndex(planId) else { return }
        let n = state.plans[p].days.count
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        state.plans[p].days.append(PlanDay(name: n < letters.count ? "Dzień \(letters[n])" : "Dzień \(n + 1)"))
    }

    func deleteDay(planId: String, dayId: String) {
        guard let p = pIndex(planId) else { return }
        state.plans[p].days.removeAll { $0.id == dayId }
    }

    func moveDay(planId: String, dayId: String, by delta: Int) {
        guard let p = pIndex(planId), let i = state.plans[p].days.firstIndex(where: { $0.id == dayId }) else { return }
        let j = i + delta
        guard j >= 0, j < state.plans[p].days.count else { return }
        state.plans[p].days.swapAt(i, j)
    }

    func addItems(_ ids: [String], planId: String, dayId: String) {
        guard let p = pIndex(planId), let d = state.plans[p].days.firstIndex(where: { $0.id == dayId }) else { return }
        state.plans[p].days[d].items.append(contentsOf: ids.map { newItem($0) })
    }

    func deleteItem(_ ref: ItemRef) {
        guard let p = pIndex(ref.planId), let d = state.plans[p].days.firstIndex(where: { $0.id == ref.dayId }) else { return }
        state.plans[p].days[d].items.removeAll { $0.id == ref.itemId }
    }

    func setsSummary(_ it: PlanItem) -> String {
        let s = it.sets
        guard let first = s.first else { return "brak serii" }
        var main: String
        if it.isTime {
            main = s.allSatisfy({ $0.sec == first.sec }) ? "\(s.count) × \(fmtN(first.sec ?? 0)) s" : s.map { fmtN($0.sec ?? 0) }.joined(separator: "/") + " s"
        } else {
            main = s.allSatisfy({ $0.reps == first.reps }) ? "\(s.count) × \(fmtN(first.reps ?? 0))" : s.map { fmtN($0.reps ?? 0) }.joined(separator: "/")
        }
        if s.contains(where: { $0.kg != nil }) {
            main += " · " + (s.allSatisfy({ $0.kg == first.kg }) ? fmtN(first.kg) : s.map { $0.kg == nil ? "–" : fmtN($0.kg) }.joined(separator: "/")) + " kg"
        }
        return main + " · przerwa " + fmtRest(it.rest)
    }

    // MARK: Trening

    func wexBinding(_ key: String) -> Binding<WEx> {
        Binding(
            get: { self.active?.ex.first(where: { $0.id == key }) ?? WEx(id: key, exId: "", mode: "reps", rest: 0, restAfter: 0, sets: []) },
            set: { newValue in
                guard var a = self.active, let i = a.ex.firstIndex(where: { $0.id == key }) else { return }
                a.ex[i] = newValue
                self.active = a
            }
        )
    }

    var currentKey: String? {
        guard let a = active else { return nil }
        if let f = a.timer?.focus, let x = a.ex.first(where: { $0.id == f }), x.hasUndone { return f }
        return a.ex.first(where: { $0.hasUndone })?.id
    }

    func start(planId: String, dayId: String) {
        guard let p = state.plans.first(where: { $0.id == planId }),
              let d = p.days.first(where: { $0.id == dayId }) else { return }
        let exs: [WEx] = d.items.map { it in
            let last = lastFor(it.exId)
            let sets: [WSet] = it.sets.enumerated().map { pair in
                let (j, s) = pair
                var lastKg: Double? = nil
                if let last, j < last.sets.count { lastKg = last.sets[j].kg }
                return WSet(tReps: s.reps, tKg: s.kg, tSec: s.sec, reps: s.reps, kg: s.kg ?? lastKg, sec: s.sec)
            }
            return WEx(itemId: it.id, exId: it.exId, mode: it.mode, rest: it.rest, restAfter: it.restAfter, note: it.note, sets: sets)
        }
        cancelNotification()
        active = ActiveWorkout(planId: p.id, dayId: d.id, planName: p.name.isEmpty ? "Plan" : p.name,
                               dayName: d.name.isEmpty ? "Trening" : d.name, ex: exs)
        showWorkout = true
        requestNotifications()
    }

    func newWorkoutEx(_ exId: String) -> WEx {
        let t = ex(exId).isTime
        let last = lastFor(exId)
        let sets: [WSet] = (0..<3).map { j in
            var kg: Double? = nil
            var reps: Double? = t ? nil : 10
            if let last, j < last.sets.count { kg = last.sets[j].kg; if !t { reps = last.sets[j].reps ?? 10 } }
            return WSet(reps: reps, kg: kg, sec: t ? 30 : nil)
        }
        return WEx(exId: exId, mode: t ? "time" : "reps", rest: state.settings.restSet, restAfter: state.settings.restEx, sets: sets)
    }

    func addToWorkout(_ ids: [String]) {
        guard var a = active else { return }
        a.ex.append(contentsOf: ids.map { newWorkoutEx($0) })
        active = a
    }

    private func makeTimer(kind: String, seconds: Double, label: String, focus: String?, exKey: String? = nil, setId: String? = nil) -> RestTimer? {
        guard seconds > 0 else { return nil }
        return RestTimer(kind: kind, total: seconds, endsAt: Date().addingTimeInterval(seconds), label: label,
                         focus: focus, exKey: exKey, setId: setId)
    }

    private func nextUndone(in a: ActiveWorkout, after index: Int) -> String? {
        if let k = a.ex.indices.first(where: { $0 > index && a.ex[$0].hasUndone }) { return a.ex[k].id }
        return a.ex.first(where: { $0.hasUndone })?.id
    }

    func toggleSet(key: String, setId: String) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }),
              let j = a.ex[i].sets.firstIndex(where: { $0.id == setId }) else { return }
        a.ex[i].sets[j].done.toggle()
        if a.ex[i].sets[j].done {
            if !a.ex[i].isTime, a.ex[i].sets[j].reps == nil { a.ex[i].sets[j].reps = a.ex[i].sets[j].tReps }
            active = a
            afterSetDone(key: key)
        } else {
            if a.timer?.kind == "rest", a.timer?.focus == key { a.timer = nil; cancelNotification() }
            active = a
        }
    }

    func afterSetDone(key: String) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }) else { return }
        let x = a.ex[i]
        if x.hasUndone {
            a.timer = state.settings.autoRest ? makeTimer(kind: "rest", seconds: x.rest, label: "Przerwa między seriami", focus: key) : nil
        } else if let next = nextUndone(in: a, after: i), let nx = a.ex.first(where: { $0.id == next }) {
            a.timer = state.settings.autoRest
                ? makeTimer(kind: "rest", seconds: x.restAfter, label: "Przerwa · następne: " + ex(nx.exId).name, focus: next)
                : nil
        } else {
            a.timer = nil
            allDoneMessage = true
        }
        active = a
        schedule(a.timer)
    }

    func startWork(key: String, setId: String) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }),
              let j = a.ex[i].sets.firstIndex(where: { $0.id == setId }) else { return }
        let sec = a.ex[i].sets[j].sec ?? a.ex[i].sets[j].tSec ?? 30
        a.ex[i].sets[j].sec = sec
        a.timer = makeTimer(kind: "work", seconds: sec, label: "Seria w toku · " + ex(a.ex[i].exId).name,
                            focus: key, exKey: key, setId: setId)
        active = a
        schedule(a.timer)
    }

    func stopWork() {
        guard var a = active, let t = a.timer, t.kind == "work", let key = t.exKey, let sid = t.setId,
              let i = a.ex.firstIndex(where: { $0.id == key }),
              let j = a.ex[i].sets.firstIndex(where: { $0.id == sid }) else { return }
        let started = t.endsAt.addingTimeInterval(-t.total)
        a.ex[i].sets[j].sec = max(1, Date().timeIntervalSince(started).rounded())
        a.ex[i].sets[j].done = true
        a.timer = nil
        active = a
        afterSetDone(key: key)
    }

    func tick() {
        guard var a = active, var t = a.timer, !t.fired, Date() >= t.endsAt else { return }
        let late = Date().timeIntervalSince(t.endsAt) > 3
        t.fired = true
        if !late { alarm() }
        if t.kind == "work", let key = t.exKey, let sid = t.setId,
           let i = a.ex.firstIndex(where: { $0.id == key }),
           let j = a.ex[i].sets.firstIndex(where: { $0.id == sid }) {
            a.ex[i].sets[j].sec = t.total
            a.ex[i].sets[j].done = true
            a.timer = nil
            active = a
            afterSetDone(key: key)
        } else {
            a.timer = t
            active = a
            if !late { scrollTarget = t.focus }
        }
    }

    func timerStart() {
        guard var a = active else { return }
        let key = currentKey
        let rest = a.ex.first(where: { $0.id == key })?.rest ?? state.settings.restSet
        a.timer = makeTimer(kind: "rest", seconds: rest, label: "Przerwa między seriami", focus: key)
        active = a
        schedule(a.timer)
    }

    func timerAdjust(_ delta: Double) {
        guard var a = active, var t = a.timer else { return }
        t.endsAt = t.endsAt.addingTimeInterval(delta)
        t.total = max(1, t.total + delta)
        a.timer = t.endsAt <= Date() ? nil : t
        active = a
        schedule(a.timer)
    }

    func timerSkip() {
        guard var a = active else { return }
        let focus = a.timer?.focus
        a.timer = nil
        active = a
        cancelNotification()
        scrollTarget = focus
    }

    func addSet(_ key: String) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }) else { return }
        let l = a.ex[i].sets.last
        a.ex[i].sets.append(WSet(tReps: l?.tReps, tKg: l?.tKg, tSec: l?.tSec, reps: l?.reps, kg: l?.kg, sec: l?.sec))
        active = a
    }

    func removeSet(_ key: String) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }), a.ex[i].sets.count > 1 else { return }
        if let k = a.ex[i].sets.lastIndex(where: { !$0.done }) { a.ex[i].sets.remove(at: k) } else { a.ex[i].sets.removeLast() }
        active = a
    }

    func adjustRest(_ key: String, by delta: Double) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }) else { return }
        a.ex[i].rest = min(600, max(0, a.ex[i].rest + delta))
        active = a
    }

    func moveEx(_ key: String, by delta: Int) {
        guard var a = active, let i = a.ex.firstIndex(where: { $0.id == key }) else { return }
        let j = i + delta
        guard j >= 0, j < a.ex.count else { return }
        a.ex.swapAt(i, j)
        active = a
    }

    func removeEx(_ key: String) {
        guard var a = active else { return }
        a.ex.removeAll { $0.id == key }
        if a.timer?.focus == key || a.timer?.exKey == key { a.timer = nil; cancelNotification() }
        active = a
    }

    func buildSession(_ a: ActiveWorkout) -> Session {
        let exs: [SessionEx] = a.ex.compactMap { x in
            let sets: [SessionSet] = x.sets.filter { $0.done }.map { s in
                x.isTime ? SessionSet(kg: s.kg, sec: s.sec ?? 0) : SessionSet(reps: s.reps ?? 0, kg: s.kg)
            }
            return sets.isEmpty ? nil : SessionEx(exId: x.exId, name: ex(x.exId).name, mode: x.mode, sets: sets)
        }
        return Session(id: a.id, date: ISO.string(a.startedAt), dur: Date().timeIntervalSince(a.startedAt).rounded(),
                       planId: a.planId, planName: a.planName, dayId: a.dayId, dayName: a.dayName, ex: exs)
    }

    func finish(updatePlan: Bool) {
        guard let a = active else { return }
        let s = buildSession(a)
        if updatePlan, let pid = a.planId, let did = a.dayId, let p = pIndex(pid),
           let d = state.plans[p].days.firstIndex(where: { $0.id == did }) {
            for x in a.ex {
                guard let itemId = x.itemId,
                      let i = state.plans[p].days[d].items.firstIndex(where: { $0.id == itemId }) else { continue }
                let done = x.sets.filter { $0.done }
                if done.isEmpty { continue }
                state.plans[p].days[d].items[i].mode = x.mode
                state.plans[p].days[d].items[i].rest = x.rest
                state.plans[p].days[d].items[i].sets = done.map { s in
                    x.isTime ? PlanSet(kg: s.kg, sec: s.sec ?? 30) : PlanSet(reps: s.reps ?? 10, kg: s.kg)
                }
            }
        }
        if !s.ex.isEmpty { sessions.insert(s, at: 0) }
        endWorkout()
    }

    func discard() { endWorkout() }

    private func endWorkout() {
        cancelNotification()
        showWorkout = false
        active = nil
    }

    // MARK: Powiadomienia i dźwięk

    func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
            self?.refreshNotificationStatus()
        }
    }

    func refreshNotificationStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async { self?.notifStatus = settings.authorizationStatus }
        }
    }

    private func schedule(_ t: RestTimer?) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["timer"])
        guard let t, !t.fired else { return }
        let interval = t.endsAt.timeIntervalSinceNow
        guard interval > 0.5 else { return }
        let content = UNMutableNotificationContent()
        content.title = t.kind == "work" ? "Koniec serii" : "Koniec przerwy"
        content.body = t.kind == "work" ? "Seria zaliczona. Czas na przerwę." : "Czas na kolejną serię."
        if state.settings.sound { content.sound = .default }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        center.add(UNNotificationRequest(identifier: "timer", content: content, trigger: trigger))
    }

    func cancelNotification() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["timer"])
    }

    private func alarm() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if state.settings.sound && notifStatus != .authorized {
            AudioServicesPlaySystemSound(1005)
        }
    }

    // MARK: Kopia zapasowa

    func exportJSON() -> String {
        let backup = Backup(exported: ISO.string(Date()), state: state, sessions: sessions)
        guard let data = try? JSONEncoder().encode(backup) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Zwraca komunikat błędu albo nil, gdy się udało.
    func importJSON(_ text: String) -> String? {
        guard let data = text.data(using: .utf8),
              let backup = try? JSONDecoder().decode(Backup.self, from: data),
              backup.app == "dziennik-silowni" else {
            return "W schowku nie ma kopii danych z Dziennika siłowni. Skopiuj dane jeszcze raz i spróbuj ponownie."
        }
        state = backup.state
        let have = Set(sessions.map { $0.id })
        let incoming = (backup.sessions ?? []).filter { !have.contains($0.id) }
        sessions = (sessions + incoming).sorted { $0.date > $1.date }
        return nil
    }
}
