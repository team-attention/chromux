import SwiftUI
import ChromuxStatusBarCore

/// Read-only menu bar dropdown (R2, D20): summary of active profiles only.
/// No kill/delete controls live here; clicking a row opens the main window.
struct MenuBarContentView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    // Visibility-gated polling (R6, AC9) is driven by AppDelegate observing
    // NSMenu.didBeginTracking/didEndTracking for this menu, not by SwiftUI
    // view lifecycle: MenuBarExtra's `.menu` style content is converted into
    // native NSMenuItems with no onAppear/onDisappear of its own.
    var body: some View {
        if !model.isServerReachable {
            Text("Server not running")
            Text(model.statusLine).foregroundStyle(.secondary)
            Button("Restart Server") { model.restartServer() }
            Divider()
        } else {
            let active = model.orderedActiveProfiles
            if active.isEmpty {
                Text("No active profiles")
            } else {
                ForEach(active) { profile in
                    Button(menuTitle(for: profile)) {
                        model.selectedProfileName = profile.name
                        openWindow(id: "main")
                    }
                }
            }
            Divider()
        }

        Button("Open chromux") {
            openWindow(id: "main")
        }
        Button("Quit") {
            model.stopServer()
            NSApp.terminate(nil)
        }
    }

    private func menuTitle(for profile: ProfileState) -> String {
        var parts = [String]()
        if let activeTabs = profile.activeTabs {
            parts.append("\(activeTabs) tab\(activeTabs == 1 ? "" : "s")")
        } else {
            parts.append("tabs unknown")
        }
        parts.append(ByteFormatter.format(profile.diskUsageBytes))
        if let port = profile.port {
            parts.append(":\(port)")
        }
        return "\(profile.name) - \(profile.status), \(parts.joined(separator: ", "))"
    }
}
