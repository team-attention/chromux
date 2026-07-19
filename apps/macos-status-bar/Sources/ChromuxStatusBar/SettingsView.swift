import SwiftUI
import ServiceManagement

/// Launch at Login toggle, carried over unchanged from the previous wrapper (R8, AC14).
struct SettingsView: View {
    @ObservedObject var model: AppModel
    @State private var launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Toggle("Launch at Login", isOn: Binding(
                get: { launchAtLoginEnabled },
                set: { toggleLaunchAtLogin($0) }
            ))
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(20)
        .frame(width: 320)
        .onAppear { launchAtLoginEnabled = SMAppService.mainApp.status == .enabled }
    }

    private func toggleLaunchAtLogin(_ isOn: Bool) {
        do {
            if isOn {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            errorMessage = nil
        } catch {
            errorMessage = "Launch at Login failed: \(error.localizedDescription)"
        }
        launchAtLoginEnabled = SMAppService.mainApp.status == .enabled
    }
}
