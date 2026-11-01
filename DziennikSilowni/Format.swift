import SwiftUI
import UIKit

let PL = Locale(identifier: "pl_PL")

let GROUPS = ["Klatka piersiowa", "Plecy", "Barki", "Biceps", "Triceps", "Czworogłowe uda",
              "Dwugłowe uda", "Pośladki i biodra", "Łydki", "Brzuch", "Całe ciało", "Cardio"]
let EQUIPS = ["Sztanga", "Sztanga łamana", "Hantle", "Kettlebell", "Wyciąg", "Maszyna", "Masa ciała", "Guma", "Inne"]

private let numberFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.locale = PL
    f.numberStyle = .decimal
    f.maximumFractionDigits = 2
    f.minimumFractionDigits = 0
    f.usesGroupingSeparator = false
    return f
}()

func fmtN(_ v: Double?) -> String {
    guard let v else { return "" }
    return numberFormatter.string(from: NSNumber(value: v)) ?? String(v)
}

func parseNum(_ s: String) -> Double? {
    var t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
    if t.hasSuffix(".") { t.removeLast() }
    if t.isEmpty { return nil }
    return Double(t)
}

func fmtClock(_ seconds: Double) -> String {
    let v = max(0, Int(seconds.rounded()))
    let h = v / 3600, m = (v % 3600) / 60, s = v % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

func fmtRest(_ seconds: Double) -> String {
    let v = Int(seconds)
    if v < 60 { return "\(v) s" }
    return v % 60 == 0 ? "\(v / 60) min" : "\(v / 60) min \(v % 60) s"
}

func fmtDur(_ seconds: Double) -> String {
    let m = Int((seconds / 60).rounded())
    return m < 60 ? "\(m) min" : "\(m / 60) h \(m % 60) min"
}

func pl(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
    let d = n % 10, h = n % 100
    if n == 1 { return one }
    if d >= 2 && d <= 4 && (h < 12 || h > 14) { return few }
    return many
}

func fmtDay(_ d: Date) -> String { d.formatted(.dateTime.day().month(.abbreviated).locale(PL)) }
func fmtDayLong(_ d: Date) -> String { d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).locale(PL)) }
func fmtMonth(_ d: Date) -> String {
    let s = d.formatted(.dateTime.month(.wide).year().locale(PL))
    return s.prefix(1).uppercased() + s.dropFirst()
}

func relDay(_ d: Date) -> String {
    let cal = Calendar.current
    let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
    if days <= 0 { return "dziś" }
    if days == 1 { return "wczoraj" }
    if days < 7 { return "\(days) dni temu" }
    return fmtDay(d)
}

func fmtSet(_ s: SessionSet, time: Bool) -> String {
    if time { return fmtN(s.sec ?? 0) + " s" + ((s.kg ?? 0) > 0 ? " · " + fmtN(s.kg) + " kg" : "") }
    return ((s.kg ?? 0) > 0 ? fmtN(s.kg) + "×" : "") + fmtN(s.reps ?? 0)
}

func norm(_ s: String) -> String {
    s.lowercased().replacingOccurrences(of: "ł", with: "l").folding(options: .diacriticInsensitive, locale: nil)
}

func youTube(_ query: String) -> URL {
    let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    return URL(string: "https://www.youtube.com/results?search_query=" + q) ?? URL(string: "https://www.youtube.com")!
}

func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}

// MARK: - Kolory

private func adaptive(_ light: UIColor, _ dark: UIColor) -> Color {
    Color(uiColor: UIColor { traits in traits.userInterfaceStyle == .dark ? dark : light })
}
private func rgb(_ hex: UInt32) -> UIColor {
    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

extension Color {
    static let brand = adaptive(rgb(0x1D4ED8), rgb(0x7D9DFF))
    static let good = adaptive(rgb(0x15784A), rgb(0x4CC386))
    static let goodInk = adaptive(rgb(0xFFFFFF), rgb(0x06150D))
    static let goodSoft = adaptive(rgb(0xD7EFE2), rgb(0x12301F))
    static let timerBG = adaptive(rgb(0x13171B), rgb(0xE6EAEE))
    static let timerFG = adaptive(rgb(0xF2F4F6), rgb(0x101316))
    static let timerMuted = adaptive(rgb(0xA3ACB5), rgb(0x56606A))
    static let timerWarn = adaptive(rgb(0xF2C230), rgb(0x8A5A00))
    static let timerOver = adaptive(rgb(0x2FA36B), rgb(0x4CC386))
    static let timerOverInk = adaptive(rgb(0x06150D), rgb(0x06150D))
    static let fieldFill = Color(uiColor: .tertiarySystemFill)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
}

// MARK: - Zdjęcia ćwiczeń (każdy plik to dwie klatki jedna pod drugą)

final class FramePair {
    let start: UIImage
    let end: UIImage
    init(start: UIImage, end: UIImage) { self.start = start; self.end = end }
}

final class FrameCache {
    static let shared = FrameCache()
    private let frames = NSCache<NSString, FramePair>()
    private let thumbs = NSCache<NSString, UIImage>()

    private func url(_ id: String) -> URL? {
        Bundle.main.url(forResource: id, withExtension: "jpg", subdirectory: "img")
            ?? Bundle.main.url(forResource: id, withExtension: "jpg")
    }

    func pair(_ id: String) -> FramePair? {
        if let p = frames.object(forKey: id as NSString) { return p }
        guard let u = url(id), let img = UIImage(contentsOfFile: u.path), let cg = img.cgImage else { return nil }
        let w = cg.width, h = cg.height / 2
        guard let a = cg.cropping(to: CGRect(x: 0, y: 0, width: w, height: h)),
              let b = cg.cropping(to: CGRect(x: 0, y: h, width: w, height: h)) else { return nil }
        let p = FramePair(start: UIImage(cgImage: a), end: UIImage(cgImage: b))
        frames.setObject(p, forKey: id as NSString)
        return p
    }

    func thumb(_ id: String) -> UIImage? {
        if let t = thumbs.object(forKey: id as NSString) { return t }
        guard let p = pair(id) else { return nil }
        let size = CGSize(width: 120, height: 80)
        let t = UIGraphicsImageRenderer(size: size).image { _ in p.start.draw(in: CGRect(origin: .zero, size: size)) }
        thumbs.setObject(t, forKey: id as NSString)
        return t
    }
}

// MARK: - Talerze na gryf

enum Plates {
    static let sizes: [Double] = [25, 20, 15, 10, 5, 2.5, 1.25]
    static func perSide(total: Double, bar: Double) -> (plates: [Double], missing: Double) {
        var side = (total - bar) / 2
        var out: [Double] = []
        for p in sizes {
            while side >= p - 0.0001 { out.append(p); side -= p }
        }
        return (out, (side * 100).rounded() / 100)
    }
    static func color(_ p: Double) -> Color {
        switch p {
        case 25: return Color(uiColor: rgb(0xC8102E))
        case 20: return Color(uiColor: rgb(0x1D4ED8))
        case 15: return Color(uiColor: rgb(0xE5B000))
        case 10: return Color(uiColor: rgb(0x178A45))
        case 5: return Color(uiColor: rgb(0xF4F4F1))
        default: return Color(uiColor: rgb(0x4A5058))
        }
    }
    static func ink(_ p: Double) -> Color { (p == 15 || p == 5) ? Color(uiColor: rgb(0x1B1D20)) : .white }
}
