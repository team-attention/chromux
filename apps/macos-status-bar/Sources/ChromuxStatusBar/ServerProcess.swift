import Foundation

/// Spawns and supervises the local `chromux app` HTTP server as a child process,
/// same as the previous AppKit wrapper's `main.swift`. The native app remains a
/// pure REST client of this server; no profile-management logic is duplicated here.
final class ServerProcess {
    private(set) var process: Process?
    private(set) var serverURL: URL?

    var onStatus: ((String) -> Void)?
    var onURLDiscovered: ((URL) -> Void)?
    var onTerminated: (() -> Void)?

    var isRunning: Bool { process != nil }

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

        for candidate in nodeCandidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return (
                URL(fileURLWithPath: candidate),
                [chromuxPath, "app", "--host", "127.0.0.1", "--port", "0"]
            )
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

    func start() {
        guard process == nil else { return }
        guard let chromuxPath = resourcePath("chromux", type: "mjs") else {
            onStatus?("Missing chromux.mjs")
            return
        }

        let proc = Process()
        let output = Pipe()
        let error = Pipe()
        let launch = statusAppLaunch(chromuxPath: chromuxPath)
        proc.executableURL = launch.executable
        proc.arguments = launch.arguments
        proc.standardOutput = output
        proc.standardError = error
        proc.environment = serverEnvironment()
        proc.terminationHandler = { [weak self] terminated in
            DispatchQueue.main.async {
                guard let self, self.process === terminated else { return }
                self.process = nil
                self.serverURL = nil
                self.onStatus?("Server stopped")
                self.onTerminated?()
            }
        }

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.handleServerOutput(text) }
        }

        error.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.onStatus?(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }

        do {
            try proc.run()
            process = proc
            onStatus?("Starting local server...")
        } catch {
            onStatus?("Launch failed: \(error.localizedDescription)")
        }
    }

    private func handleServerOutput(_ text: String) {
        for line in text.split(separator: "\n").map(String.init) {
            guard let range = line.range(of: "http://127.0.0.1:") else { continue }
            let urlText = String(line[range.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: urlText) else { continue }
            serverURL = url
            onStatus?(url.absoluteString)
            onURLDiscovered?(url)
        }
    }

    func stop() {
        process?.terminate()
        process = nil
        serverURL = nil
    }
}
