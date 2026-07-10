import Foundation
import AppKit
import WebKit

struct StatusState: Decodable {
    let profiles: [ProfileState]
}

struct ProfileState: Decodable {
    let name: String
    let status: String
    let port: Int?
    let activeTabs: Int?
    let daemon: DaemonState?

    var isActive: Bool {
        status == "running" || (activeTabs ?? 0) > 0 || daemon?.status == "running"
    }

    var menuTitle: String {
        let tabText = activeTabs.map { "\($0) tab\($0 == 1 ? "" : "s")" } ?? "tabs unknown"
        if let port {
            return "\(name) - \(status), \(tabText), :\(port)"
        }
        return "\(name) - \(status), \(tabText)"
    }
}

struct DaemonState: Decodable {
    let status: String
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var serverProcess: Process?
    private var serverURL: URL?
    private var window: NSWindow?
    private var webView: WKWebView?
    private let statusMenu = NSMenu()
    private let statusLine = NSMenuItem(title: "Starting local server...", action: nil, keyEquivalent: "")
    private var profileMenuItems: [NSMenuItem] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        startServer()
        openDashboard()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    private func configureStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "cx"
            button.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .bold)
        }

        statusLine.isEnabled = false
        statusMenu.delegate = self
        statusMenu.addItem(statusLine)
        statusMenu.addItem(NSMenuItem.separator())
        statusMenu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "o"))
        statusMenu.addItem(NSMenuItem(title: "Open In Browser", action: #selector(openInBrowser), keyEquivalent: "b"))
        statusMenu.addItem(NSMenuItem(title: "Restart Local Server", action: #selector(restartServer), keyEquivalent: "r"))
        statusMenu.addItem(NSMenuItem.separator())
        statusMenu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        statusMenu.items.forEach { $0.target = self }
        statusItem.menu = statusMenu
        log("status item ready: cx")
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshProfileMenu()
    }

    private func resourcePath(_ name: String, type: String? = nil) -> String? {
        Bundle.main.path(forResource: name, ofType: type)
    }

    private func statusAppLaunch(chromuxPath: String) -> (executable: URL, arguments: [String]) {
        let nodeCandidates = [
            ProcessInfo.processInfo.environment["CHROMUX_NODE"],
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 }

        for candidate in nodeCandidates {
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return (
                    URL(fileURLWithPath: candidate),
                    [chromuxPath, "app", "--host", "127.0.0.1", "--port", "0"]
                )
            }
        }

        return (
            URL(fileURLWithPath: "/usr/bin/env"),
            ["node", chromuxPath, "app", "--host", "127.0.0.1", "--port", "0"]
        )
    }

    private func serverEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let defaultPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        if let path = env["PATH"], !path.isEmpty {
            env["PATH"] = "\(defaultPath):\(path)"
        } else {
            env["PATH"] = defaultPath
        }
        return env
    }

    private func startServer() {
        guard serverProcess == nil else { return }
        guard let chromuxPath = resourcePath("chromux", type: "mjs") else {
            updateStatus("Missing chromux.mjs")
            return
        }

        let process = Process()
        let output = Pipe()
        let error = Pipe()
        let launch = statusAppLaunch(chromuxPath: chromuxPath)
        process.executableURL = launch.executable
        process.arguments = launch.arguments
        process.standardOutput = output
        process.standardError = error
        process.environment = serverEnvironment()
        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                if self?.serverProcess === proc {
                    self?.serverProcess = nil
                    self?.serverURL = nil
                    self?.updateStatus("Server stopped")
                }
            }
        }

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.handleServerOutput(text)
            }
        }

        error.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.updateStatus(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }

        do {
            try process.run()
            serverProcess = process
            updateStatus("Starting local server...")
        } catch {
            updateStatus("Launch failed: \(error.localizedDescription)")
        }
    }

    private func handleServerOutput(_ text: String) {
        for line in text.split(separator: "\n").map(String.init) {
            guard let range = line.range(of: "http://127.0.0.1:") else { continue }
            let urlText = String(line[range.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if let url = URL(string: urlText) {
                serverURL = url
                updateStatus(url.absoluteString)
                loadDashboardIfVisible()
                refreshProfileMenu()
            }
        }
    }

    private func updateStatus(_ text: String) {
        // Keep the status line to one short readable line.
        let firstLine = text.split(separator: "\n").first.map(String.init) ?? ""
        let compact = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
        statusLine.title = compact.isEmpty ? "chromux status" : String(compact.prefix(80))
    }

    private func replaceProfileMenuItems(with items: [NSMenuItem]) {
        for item in profileMenuItems {
            statusMenu.removeItem(item)
        }
        profileMenuItems = items

        let insertIndex = min(2, statusMenu.numberOfItems)
        for (offset, item) in items.enumerated() {
            statusMenu.insertItem(item, at: insertIndex + offset)
        }
        statusMenu.update()
    }

    private func refreshProfileMenu() {
        guard let stateURL = serverURL?.appendingPathComponent("api/state") else {
            replaceProfileMenuItems(with: disabledProfileItems(["Profiles unavailable until server starts"]))
            return
        }

        replaceProfileMenuItems(with: disabledProfileItems(["Loading profiles..."]))

        URLSession.shared.dataTask(with: stateURL) { [weak self] data, _, error in
            var messages: [String]?
            var activeProfiles: [ProfileState] = []
            if let error {
                messages = ["Profiles unavailable: \(error.localizedDescription)"]
            } else if let data, let state = try? JSONDecoder().decode(StatusState.self, from: data) {
                activeProfiles = state.profiles
                    .filter { $0.isActive }
                    .sorted {
                        if $0.status == $1.status { return $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                        return $0.status == "running"
                    }
                if activeProfiles.isEmpty {
                    messages = ["No active profiles"]
                }
            } else {
                messages = ["Profiles unavailable: invalid server response"]
            }

            DispatchQueue.main.async {
                guard let self else { return }
                if let messages {
                    self.replaceProfileMenuItems(with: self.disabledProfileItems(messages))
                } else {
                    self.replaceProfileMenuItems(with: self.activeProfileItems(activeProfiles))
                }
            }
        }.resume()
    }

    private func disabledProfileItems(_ titles: [String]) -> [NSMenuItem] {
        titles.map { title in
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.isEnabled = false
            return item
        }
    }

    private func activeProfileItems(_ profiles: [ProfileState]) -> [NSMenuItem] {
        let header = NSMenuItem(title: "Active Profiles", action: nil, keyEquivalent: "")
        header.isEnabled = false
        header.attributedTitle = NSAttributedString(
            string: "Active Profiles",
            attributes: [
                .font: NSFont.menuBarFont(ofSize: 0).withSize(11),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]
        )

        let rows = profiles.map { profile in
            let item = NSMenuItem(title: profile.menuTitle, action: #selector(openDashboard), keyEquivalent: "")
            item.target = self
            item.toolTip = "Open the chromux dashboard"
            return item
        }
        log("active profile menu: \(rows.count) clickable item(s) wired to openDashboard")
        return [header] + rows
    }

    private func stopServer() {
        serverProcess?.terminate()
        serverProcess = nil
    }

    @objc private func restartServer() {
        stopServer()
        serverURL = nil
        updateStatus("Restarting local server...")
        startServer()
    }

    @objc private func openDashboard() {
        if serverProcess == nil {
            startServer()
        }

        if window == nil {
            // Match the dashboard canvas color from status-app/DESIGN.md (#010102)
            // so no light chrome or white flash frames the dark page.
            let canvas = NSColor(srgbRed: 1.0 / 255.0, green: 1.0 / 255.0, blue: 2.0 / 255.0, alpha: 1.0)

            let config = WKWebViewConfiguration()
            let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1120, height: 760), configuration: config)
            web.navigationDelegate = self
            web.underPageBackgroundColor = canvas
            webView = web

            let win = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            win.title = "chromux status"
            win.appearance = NSAppearance(named: .darkAqua)
            win.backgroundColor = canvas
            win.titlebarAppearsTransparent = true
            win.contentView = web
            win.center()
            window = win
            log("dashboard window ready: background=\(canvas.description), appearance=\(win.appearance?.name.rawValue ?? "default"), titlebarTransparent=\(win.titlebarAppearsTransparent)")
        }

        loadDashboardIfVisible()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadDashboardIfVisible() {
        guard let url = serverURL, let webView else { return }
        if webView.url != url {
            webView.load(URLRequest(url: url))
        }
    }

    // QA hook: CHROMUX_STATUS_WINDOW_SNAPSHOT=<path-prefix> writes
    // <prefix>-chrome.png (window frame incl. titlebar) and
    // <prefix>-content.png (rendered dashboard) after load, without needing
    // the OS Screen Recording permission.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let base = ProcessInfo.processInfo.environment["CHROMUX_STATUS_WINDOW_SNAPSHOT"], !base.isEmpty else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.writeWindowSnapshots(basePath: base)
        }
    }

    private func writeWindowSnapshots(basePath: String) {
        guard let window, let webView else { return }
        if let frameView = window.contentView?.superview,
           let rep = frameView.bitmapImageRepForCachingDisplay(in: frameView.bounds) {
            frameView.cacheDisplay(in: frameView.bounds, to: rep)
            if let data = rep.representation(using: .png, properties: [:]) {
                try? data.write(to: URL(fileURLWithPath: basePath + "-chrome.png"))
                log("window chrome snapshot written: \(basePath)-chrome.png")
            }
        }
        webView.takeSnapshot(with: WKSnapshotConfiguration()) { [weak self] image, _ in
            guard let self, let image, let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let data = rep.representation(using: .png, properties: [:]) else { return }
            try? data.write(to: URL(fileURLWithPath: basePath + "-content.png"))
            self.log("web content snapshot written: \(basePath)-content.png")
        }
    }

    @objc private func openInBrowser() {
        guard let url = serverURL else {
            startServer()
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(("chromux status: \(message)\n").data(using: .utf8)!)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
