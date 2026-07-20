import SwiftUI
import AppKit

/// Retrieves the real `NSWindow` hosting a SwiftUI view. `Window`
/// windows are not reliably observable via `NSApp.windows` or global
/// `NSWindow` notifications in this app's SwiftUI runtime, so visibility
/// tracking for the main window (R6, AC9) hooks the window instance found
/// this way directly, via `NSWindowDelegate`.
struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            if let window = view.window {
                onResolve(window)
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
