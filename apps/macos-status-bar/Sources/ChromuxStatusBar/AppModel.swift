import Foundation
import SwiftUI
import Combine
import ChromuxStatusBarCore

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var statusState: StatusState?
    @Published private(set) var statusLine: String = "Starting local server..."
    @Published private(set) var serverURL: URL?
    @Published var selectedProfileName: String?
    @Published var searchText: String = ""
    @Published var statusFilter: ProfileStatusFilter = .all
    @Published var selectedForBulk: Set<String> = []
    @Published var pendingDeleteNames: [String]?
    @Published var lastActionMessage: String?
    @Published private(set) var visibleWindowCount: Int = 0

    private let server = ServerProcess()
    private var client: APIClient?
    private var pollTask: Task<Void, Never>?

    var profiles: [ProfileState] { statusState?.profiles ?? [] }

    var visibleProfiles: [ProfileState] {
        ProfileLogic.visible(profiles, search: searchText, statusFilter: statusFilter)
    }

    var orderedActiveProfiles: [ProfileState] {
        ProfileLogic.ordered(profiles).filter(ProfileLogic.isActive)
    }

    var selectedProfile: ProfileState? {
        guard let selectedProfileName else { return nil }
        return profiles.first { $0.name == selectedProfileName }
    }

    var isServerReachable: Bool { serverURL != nil }

    init() {
        server.onStatus = { [weak self] text in
            guard let self else { return }
            let firstLine = text.split(separator: "\n").first.map(String.init) ?? ""
            self.statusLine = firstLine.isEmpty ? "chromux status" : String(firstLine.prefix(80))
        }
        server.onURLDiscovered = { [weak self] url in
            guard let self else { return }
            self.serverURL = url
            self.client = APIClient(baseURL: url)
            Task { await self.refresh() }
        }
        server.onTerminated = { [weak self] in
            self?.serverURL = nil
            self?.client = nil
            self?.statusState = nil
        }
    }

    func startServer() {
        server.start()
    }

    func restartServer() {
        server.stop()
        serverURL = nil
        client = nil
        statusState = nil
        statusLine = "Restarting local server..."
        server.start()
    }

    func stopServer() {
        server.stop()
    }

    func refresh() async {
        guard let client else { return }
        do {
            let state = try await client.fetchState()
            statusState = state
            let names = Set(state.profiles.map(\.name))
            selectedForBulk = selectedForBulk.filter { names.contains($0) }
            if let selectedProfileName, !names.contains(selectedProfileName) {
                self.selectedProfileName = ProfileLogic.ordered(state.profiles).first?.name
            } else if selectedProfileName == nil {
                selectedProfileName = ProfileLogic.ordered(state.profiles).first?.name
            }
        } catch {
            lastActionMessage = "Refresh failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Visibility-gated polling (R6, AC9)

    func markWindowVisible() {
        visibleWindowCount += 1
        startPollingIfNeeded()
    }

    func markWindowHidden() {
        visibleWindowCount = max(0, visibleWindowCount - 1)
        if visibleWindowCount == 0 {
            stopPolling()
        }
    }

    private func startPollingIfNeeded() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 7_000_000_000)
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: - Profile actions (R3, AC7)

    func runAction(_ action: String, on profileName: String) async {
        guard let client else { return }
        do {
            let response = try await client.runProfileAction(profile: profileName, action: action)
            lastActionMessage = response.result?.stderr?.isEmpty == false
                ? response.result?.stderr
                : (response.result?.stdout?.isEmpty == false ? response.result?.stdout : "\(action) complete")
            await refresh()
        } catch {
            lastActionMessage = error.localizedDescription
        }
    }

    // MARK: - Bulk delete (R4, T5, AC5, AC6)

    func requestBulkDelete() {
        guard !selectedForBulk.isEmpty else { return }
        pendingDeleteNames = ProfileLogic.ordered(profiles)
            .map(\.name)
            .filter(selectedForBulk.contains)
    }

    func cancelPendingDelete() {
        pendingDeleteNames = nil
    }

    func confirmPendingDelete() async {
        guard let names = pendingDeleteNames, let client else { return }
        pendingDeleteNames = nil
        do {
            let response = try await client.deleteProfiles(names)
            let succeeded = response.results.filter(\.removed).map(\.profile)
            let failed = response.results.filter { !$0.removed }.map(\.profile)
            lastActionMessage = DeleteSummary.resultMessage(succeededNames: succeeded, failedNames: failed)
            selectedForBulk.subtract(succeeded)
            await refresh()
        } catch {
            lastActionMessage = "Delete failed: \(error.localizedDescription)"
        }
    }
}
