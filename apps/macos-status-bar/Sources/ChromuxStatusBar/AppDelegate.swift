import AppKit

/// Owns the single shared `AppModel` and the app lifecycle contract (R1, R5):
/// regular Dock/Cmd+Tab presence, window-close-stays-resident, and an explicit
/// Quit that stops the local server before the process exits.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        model.startServer()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.stopServer()
    }
}
