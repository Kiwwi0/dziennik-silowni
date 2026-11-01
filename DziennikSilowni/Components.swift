import SwiftUI

/// Miniatura ćwiczenia (pierwsza klatka ruchu).
struct Thumb: View {
    @EnvironmentObject var store: Store
    let exId: String
    var width: CGFloat = 60

    var body: some View {
        Group {
            if let img = FrameCache.shared.thumb(exId) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                ZStack {
                    Color.fieldFill
                    Text(String(store.ex(exId).name.prefix(1)).uppercased())
                        .font(.system(size: width * 0.32, weight: .heavy))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(width: width, height: width * 2 / 3)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Color(uiColor: .separator), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

/// Animacja ruchu: dwie klatki (start i koniec) przenikające się na zmianę.
struct ExerciseMedia: View {
    let exId: String
    let name: String
    @State private var showEnd = false
    @State private var paused = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let frames = FrameCache.shared.pair(exId) {
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Image(uiImage: frames.start).resizable().scaledToFit()
                    Image(uiImage: frames.end).resizable().scaledToFit().opacity(showEnd ? 1 : 0)
                }
                .accessibilityLabel(Text("\(name): pozycja startowa i końcowa"))
                Button(buttonTitle) {
                    if reduceMotion { withAnimation(.easeInOut(duration: 0.25)) { showEnd.toggle() } }
                    else { paused.toggle() }
                }
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.black.opacity(0.72), in: Capsule())
                .foregroundStyle(.white)
                .padding(8)
            }
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .task(id: paused) {
                guard !reduceMotion, !paused else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_400_000_000)
                    if Task.isCancelled { break }
                    withAnimation(.easeInOut(duration: 0.35)) { showEnd.toggle() }
                }
            }
        } else {
            ZStack {
                Color.fieldFill
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: 56, weight: .heavy))
                    .foregroundStyle(.secondary)
            }
            .aspectRatio(3 / 2, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private var buttonTitle: String {
        if reduceMotion { return showEnd ? "Pokaż początek ruchu" : "Pokaż koniec ruchu" }
        return paused ? "Odtwórz" : "Zatrzymaj"
    }
}

/// Pole liczbowe, które od razu zapisuje wartość (bez czekania na „Enter”).
struct NumField: View {
    let placeholder: String
    @Binding var value: Double?
    var decimal: Bool = true
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(decimal ? .decimalPad : .numberPad)
            .multilineTextAlignment(.center)
            .focused($focused)
            .onAppear { text = fmtN(value) }
            .onChange(of: text) { _, newText in
                let v = parseNum(newText)
                if v != value { value = v }
            }
            .onChange(of: value) { _, newValue in
                if !focused { text = fmtN(newValue) }
            }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { text = fmtN(value) }
            }
    }
}

struct StatTile: View {
    let label: String
    let value: String
    var unit: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value).font(.system(size: 24, weight: .heavy)).monospacedDigit()
                if !unit.isEmpty { Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.fieldFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct PlatesView: View {
    let kg: Double?
    let bar: Double

    var body: some View {
        if let kg, kg > 0 {
            if kg <= bar {
                Text("Sam gryf (\(fmtN(bar)) kg)").font(.caption).foregroundStyle(.secondary)
            } else {
                let r = Plates.perSide(total: kg, bar: bar)
                HStack(spacing: 4) {
                    Text("Na stronę gryfu:").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(r.plates.enumerated()), id: \.offset) { _, p in
                        Text(fmtN(p))
                            .font(.caption2.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(Plates.ink(p))
                            .frame(minWidth: 30, minHeight: 20)
                            .padding(.horizontal, 3)
                            .background(Plates.color(p), in: RoundedRectangle(cornerRadius: 4))
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(uiColor: .separator), lineWidth: p == 5 ? 0.5 : 0))
                    }
                    if r.missing > 0.01 {
                        Text("+ \(fmtN(r.missing)) kg").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct GroupChips: View {
    @Binding var selected: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip(nil, "Wszystkie")
                ForEach(GROUPS, id: \.self) { g in chip(g, g) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private func chip(_ value: String?, _ label: String) -> some View {
        let on = selected == value
        return Button { selected = value } label: {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(on ? Color.primary : Color.fieldFill, in: Capsule())
                .foregroundStyle(on ? Color(uiColor: .systemBackground) : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct ElapsedText: View {
    let start: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            Text(fmtClock(ctx.date.timeIntervalSince(start))).monospacedDigit()
        }
    }
}

struct KeyboardDoneToolbar: ViewModifier {
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Gotowe") { hideKeyboard() }.bold()
            }
        }
    }
}

extension View {
    func keyboardDone() -> some View { modifier(KeyboardDoneToolbar()) }
}
