import SwiftUI
import UIKit
import UserNotifications

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var message: String?
    @State private var confirmImport = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $store.state.settings.restSet, in: 0...600, step: 15) {
                        row("Między seriami", fmtRest(store.state.settings.restSet))
                    }
                    Stepper(value: $store.state.settings.restEx, in: 0...600, step: 15) {
                        row("Po ćwiczeniu", fmtRest(store.state.settings.restEx))
                    }
                } header: {
                    Text("Przerwy dla nowych ćwiczeń")
                } footer: {
                    Text("Przerwę dla konkretnego ćwiczenia zmienisz w edycji planu albo w trakcie treningu.")
                }

                Section {
                    Toggle("Uruchamiaj przerwę automatycznie po odhaczeniu serii", isOn: $store.state.settings.autoRest)
                    Toggle("Dźwięk na koniec przerwy", isOn: $store.state.settings.sound)
                    Picker("Gryf do kalkulatora talerzy", selection: $store.state.settings.bar) {
                        Text("20 kg").tag(20.0)
                        Text("15 kg").tag(15.0)
                        Text("10 kg").tag(10.0)
                    }
                }

                Section {
                    HStack {
                        Text("Powiadomienia")
                        Spacer()
                        Text(notificationText).foregroundStyle(.secondary)
                    }
                    if store.notifStatus == .denied {
                        Button("Otwórz ustawienia iPhone'a") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    } else if store.notifStatus == .notDetermined {
                        Button("Włącz powiadomienia") { store.requestNotifications() }
                    }
                } header: {
                    Text("Koniec przerwy przy zablokowanym ekranie")
                } footer: {
                    Text("Dzięki powiadomieniom usłyszysz koniec przerwy także wtedy, gdy telefon leży zablokowany albo jest w innej aplikacji.")
                }

                Section {
                    Button("Kopiuj dane do schowka") {
                        UIPasteboard.general.string = store.exportJSON()
                        message = "Skopiowano plany i historię do schowka."
                    }
                    Button("Przywróć dane ze schowka") { confirmImport = true }
                } header: {
                    Text("Kopia zapasowa")
                } footer: {
                    Text("Tak przeniesiesz dane z wersji w przeglądarce: tam w Ustawieniach stuknij „Kopiuj dane”, a tutaj „Przywróć dane ze schowka”. Zrób też kopię przed usunięciem aplikacji z telefonu.")
                }

                Section {
                    Text("Zdjęcia ćwiczeń: Free Exercise DB (domena publiczna).")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Ustawienia")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Gotowe") { dismiss() }.bold() }
            }
            .confirmationDialog("Przywrócić dane ze schowka?", isPresented: $confirmImport, titleVisibility: .visible) {
                Button("Przywróć") {
                    if let error = store.importJSON(UIPasteboard.general.string ?? "") {
                        message = error
                    } else {
                        message = "Przywrócono dane."
                    }
                }
            } message: {
                Text("Plany, własne ćwiczenia i ustawienia zostaną zastąpione kopią. Treningi z kopii zostaną dodane do historii.")
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            }
            .onAppear { store.refreshNotificationStatus() }
        }
    }

    private var notificationText: String {
        switch store.notifStatus {
        case .authorized, .provisional, .ephemeral: return "włączone"
        case .denied: return "wyłączone"
        default: return "nie ustawione"
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).monospacedDigit().foregroundStyle(.secondary)
        }
    }
}
