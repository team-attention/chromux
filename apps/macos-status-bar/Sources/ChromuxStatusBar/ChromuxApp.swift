import SwiftUI

/// SwiftUI replacement for the previous AppKit + WKWebView wrapper (R1): a
/// `MenuBarExtra` "cx" item plus a real `WindowGroup` main window under one
/// `@main App`, so the app appears in the Dock and Cmd+Tab switcher.
@main
struct ChromuxApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(model: appDelegate.model)
        } label: {
            Text("cx").font(.system(size: 13, weight: .bold, design: .monospaced))
        }

        WindowGroup(id: "main") {
            MainWindowView(model: appDelegate.model)
        }
        .defaultSize(width: 1120, height: 760)

        Settings {
            SettingsView(model: appDelegate.model)
        }
    }
}
