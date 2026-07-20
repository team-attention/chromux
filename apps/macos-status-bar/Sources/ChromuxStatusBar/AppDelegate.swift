import AppKit

/// Owns the single shared `AppModel` and the app lifecycle contract (R1, R5,
/// R6): regular Dock/Cmd+Tab presence, window-close-stays-resident, an
/// explicit Quit that stops the local server before the process exits, and
/// visibility-gated polling for both the main window and the menu bar
/// dropdown.
///
/// SwiftUI's `onAppear`/`onDisappear` are not a reliable signal here: the
/// main `Window` scene's view does not reliably receive `onDisappear` when
/// closed via the standard close button (a documented SwiftUI-on-macOS
/// limitation), and it is not observable via global `NSApp.windows` /
/// `NotificationCenter` `NSWindow` notifications either in this SwiftUI
/// runtime. Instead, `WindowAccessor` resolves the real `NSWindow` instance
/// from inside the view hierarchy and this object becomes that specific
/// window's delegate. `MenuBarExtra` content in `.menu` style has no
/// SwiftUI view lifecycle at all, so its visibility is tracked via
/// `NSMenu.didBeginTracking`/`didEndTracking` notifications instead, the
/// same mechanism the previous AppKit wrapper used
/// (`NSMenuDelegate.menuWillOpen`).
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let model = AppModel()
    private var mainWindow: NSWindow?
    private var mainWindowVisible = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        model.startServer()

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(statusMenuDidBeginTracking(_:)), name: NSMenu.didBeginTrackingNotification, object: nil)
        center.addObserver(self, selector: #selector(statusMenuDidEndTracking(_:)), name: NSMenu.didEndTrackingNotification, object: nil)
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

    // MARK: - Main window visibility (R6, AC9)

    /// Called by `WindowAccessor` once the main window resolves. Closing
    /// and reopening the single `Window(id: "main")` scene creates a fresh
    /// `NSWindow` instance each time, so this fires again on every reopen.
    func attachMainWindow(_ window: NSWindow) {
        guard mainWindow !== window else { return }
        mainWindow = window
        window.delegate = self
        if !mainWindowVisible {
            mainWindowVisible = true
            model.markWindowVisible()
        }
    }

    nonisolated func windowWillClose(_ notification: Notification) {
        Task { @MainActor in
            guard mainWindowVisible else { return }
            mainWindowVisible = false
            model.markWindowHidden()
        }
    }

    // MARK: - Menu bar dropdown visibility (R6, AC9)

    @objc private func statusMenuDidBeginTracking(_ notification: Notification) {
        guard let menu = notification.object as? NSMenu, isStatusItemMenu(menu) else { return }
        model.markWindowVisible()
    }

    @objc private func statusMenuDidEndTracking(_ notification: Notification) {
        guard let menu = notification.object as? NSMenu, isStatusItemMenu(menu) else { return }
        model.markWindowHidden()
    }

    /// The `MenuBarExtra` status item's menu is not reachable through public
    /// SwiftUI API, so it is identified by exclusion: this app has no other
    /// menus that begin tracking during normal use (the app menu bar's
    /// File/Edit/Window/Help menus are submenus of `NSApp.mainMenu`; the
    /// status item's menu is not).
    private func isStatusItemMenu(_ menu: NSMenu) -> Bool {
        guard let mainMenu = NSApp.mainMenu else { return true }
        return !mainMenu.items.contains { $0.submenu === menu }
    }
}
