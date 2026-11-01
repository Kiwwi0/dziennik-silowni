import Foundation

// Format danych jest zgodny z wersją w przeglądarce, więc kopię zapasową
// z przeglądarki można wkleić w aplikacji (Ustawienia → Przywróć dane ze schowka).

func uid() -> String {
    String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)).lowercased()
}

extension KeyedDecodingContainer {
    func num(_ key: Key) -> Double? {
        if let d = try? decode(Double.self, forKey: key) { return d }
        if let s = try? decode(String.self, forKey: key) { return parseNum(s) }
        return nil
    }
    func str(_ key: Key, _ fallback: String = "") -> String {
        (try? decode(String.self, forKey: key)) ?? fallback
    }
    func optStr(_ key: Key) -> String? {
        try? decode(String.self, forKey: key)
    }
    func strings(_ key: Key) -> [String] {
        (try? decode([String].self, forKey: key)) ?? []
    }
}

// MARK: - Ćwiczenie

struct Exercise: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var en: String? = nil
    var group: String
    var equipment: String
    var mode: String = "reps"
    var primary: [String] = []
    var secondary: [String] = []
    var level: String? = nil
    var steps: [String] = []
    var tips: [String] = []
    var custom: Bool? = nil

    var isTime: Bool { mode == "time" }
    var isCustom: Bool { custom == true }

    enum CodingKeys: String, CodingKey {
        case id, name, en, group, equipment, mode, primary, secondary, level, steps, tips, custom
    }
}

extension Exercise {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.str(.name, "Ćwiczenie")
        en = c.optStr(.en)
        group = c.str(.group)
        equipment = c.str(.equipment)
        mode = c.str(.mode, "reps")
        primary = c.strings(.primary)
        secondary = c.strings(.secondary)
        level = c.optStr(.level)
        steps = c.strings(.steps)
        tips = c.strings(.tips)
        custom = try? c.decode(Bool.self, forKey: .custom)
    }
}

// MARK: - Plany

struct PlanSet: Codable, Hashable, Identifiable {
    var id: String = uid()
    var reps: Double? = nil
    var kg: Double? = nil
    var sec: Double? = nil

    enum CodingKeys: String, CodingKey { case id, reps, kg, sec }
}

extension PlanSet {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, uid())
        reps = c.num(.reps)
        kg = c.num(.kg)
        sec = c.num(.sec)
    }
}

struct PlanItem: Codable, Hashable, Identifiable {
    var id: String = uid()
    var exId: String
    var mode: String = "reps"
    var rest: Double = 90
    var restAfter: Double = 120
    var note: String = ""
    var sets: [PlanSet] = []

    var isTime: Bool { mode == "time" }

    enum CodingKeys: String, CodingKey { case id, exId, mode, rest, restAfter, note, sets }
}

extension PlanItem {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, uid())
        exId = try c.decode(String.self, forKey: .exId)
        mode = c.str(.mode, "reps")
        rest = c.num(.rest) ?? 90
        restAfter = c.num(.restAfter) ?? 120
        note = c.str(.note)
        sets = (try? c.decode([PlanSet].self, forKey: .sets)) ?? []
    }
}

struct PlanDay: Codable, Hashable, Identifiable {
    var id: String = uid()
    var name: String
    var items: [PlanItem] = []

    enum CodingKeys: String, CodingKey { case id, name, items }
}

extension PlanDay {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, uid())
        name = c.str(.name)
        items = (try? c.decode([PlanItem].self, forKey: .items)) ?? []
    }
}

struct Plan: Codable, Hashable, Identifiable {
    var id: String = uid()
    var name: String
    var days: [PlanDay] = []

    enum CodingKeys: String, CodingKey { case id, name, days }
}

extension Plan {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, uid())
        name = c.str(.name)
        days = (try? c.decode([PlanDay].self, forKey: .days)) ?? []
    }
}

struct AppSettings: Codable, Hashable {
    var restSet: Double = 90
    var restEx: Double = 120
    var autoRest: Bool = true
    var sound: Bool = true
    var bar: Double = 20

    enum CodingKeys: String, CodingKey { case restSet, restEx, autoRest, sound, bar }
}

extension AppSettings {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        restSet = c.num(.restSet) ?? 90
        restEx = c.num(.restEx) ?? 120
        autoRest = (try? c.decode(Bool.self, forKey: .autoRest)) ?? true
        sound = (try? c.decode(Bool.self, forKey: .sound)) ?? true
        bar = c.num(.bar) ?? 20
    }
}

struct AppState: Codable, Hashable {
    var v: Int = 1
    var plans: [Plan] = []
    var custom: [Exercise] = []
    var settings = AppSettings()

    enum CodingKeys: String, CodingKey { case v, plans, custom, settings }
}

extension AppState {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = 1
        plans = (try? c.decode([Plan].self, forKey: .plans)) ?? []
        custom = (try? c.decode([Exercise].self, forKey: .custom)) ?? []
        settings = (try? c.decode(AppSettings.self, forKey: .settings)) ?? AppSettings()
    }
}

// MARK: - Historia

struct SessionSet: Codable, Hashable {
    var reps: Double? = nil
    var kg: Double? = nil
    var sec: Double? = nil

    enum CodingKeys: String, CodingKey { case reps, kg, sec }
}

extension SessionSet {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reps = c.num(.reps)
        kg = c.num(.kg)
        sec = c.num(.sec)
    }
}

struct SessionEx: Codable, Hashable, Identifiable {
    var exId: String
    var name: String
    var mode: String
    var sets: [SessionSet]

    var id: String { exId }
    var isTime: Bool { mode == "time" }

    enum CodingKeys: String, CodingKey { case exId, name, mode, sets }
}

extension SessionEx {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        exId = try c.decode(String.self, forKey: .exId)
        name = c.str(.name)
        mode = c.str(.mode, "reps")
        sets = (try? c.decode([SessionSet].self, forKey: .sets)) ?? []
    }
}

struct Session: Codable, Hashable, Identifiable {
    var id: String
    var date: String
    var dur: Double
    var planId: String?
    var planName: String
    var dayId: String?
    var dayName: String
    var ex: [SessionEx]

    var dateValue: Date { ISO.parse(date) }

    var volume: Double {
        var total = 0.0
        for x in ex where !x.isTime {
            for s in x.sets { total += (s.kg ?? 0) * (s.reps ?? 0) }
        }
        return total
    }

    var setCount: Int { ex.reduce(0) { acc, x in acc + x.sets.count } }

    enum CodingKeys: String, CodingKey { case id, date, dur, planId, planName, dayId, dayName, ex }
}

extension Session {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        date = c.str(.date, ISO.string(Date()))
        dur = c.num(.dur) ?? 0
        planId = c.optStr(.planId)
        planName = c.str(.planName)
        dayId = c.optStr(.dayId)
        dayName = c.str(.dayName, "Trening")
        ex = (try? c.decode([SessionEx].self, forKey: .ex)) ?? []
    }
}

// MARK: - Trening w toku

struct WSet: Codable, Hashable, Identifiable {
    var id: String = uid()
    var tReps: Double?
    var tKg: Double?
    var tSec: Double?
    var reps: Double?
    var kg: Double?
    var sec: Double?
    var done: Bool = false
}

struct WEx: Codable, Hashable, Identifiable {
    var id: String = uid()
    var itemId: String?
    var exId: String
    var mode: String
    var rest: Double
    var restAfter: Double
    var note: String = ""
    var sets: [WSet]

    var isTime: Bool { mode == "time" }
    var hasUndone: Bool { sets.contains { set in !set.done } }
}

struct RestTimer: Codable, Hashable {
    var kind: String          // "rest" albo "work" (seria na czas)
    var total: Double
    var endsAt: Date
    var label: String
    var focus: String?        // ćwiczenie, które jest następne
    var exKey: String?        // dla serii na czas
    var setId: String?
    var fired: Bool = false
}

struct ActiveWorkout: Codable, Hashable {
    var id: String = uid()
    var planId: String?
    var dayId: String?
    var planName: String
    var dayName: String
    var startedAt: Date = Date()
    var timer: RestTimer?
    var ex: [WEx]
}

struct Backup: Codable {
    var app: String = "dziennik-silowni"
    var v: Int = 1
    var exported: String?
    var state: AppState
    var sessions: [Session]?
}

enum ISO {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static func parse(_ s: String) -> Date { withFraction.date(from: s) ?? plain.date(from: s) ?? Date.distantPast }
    static func string(_ d: Date) -> String { withFraction.string(from: d) }
}
