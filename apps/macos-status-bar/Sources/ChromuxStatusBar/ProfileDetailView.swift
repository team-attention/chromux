import SwiftUI
import ChromuxStatusBarCore

/// Native profile detail: runtime/activity facts and actions (R3, AC7).
struct ProfileDetailView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            if let profile = model.selectedProfile {
                VStack(alignment: .leading, spacing: 20) {
                    header(profile)
                    actions(profile)
                    factsSection(title: "Runtime", rows: runtimeFacts(profile))
                    factsSection(title: "Activity", rows: activityFacts(profile))
                }
                .padding(24)
            } else {
                Text("Select a profile")
                    .foregroundStyle(DesignTokens.inkSubtle)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DesignTokens.canvas)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let message = model.lastActionMessage {
                Text(message)
                    .font(.caption)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DesignTokens.surface2)
            }
        }
    }

    private func header(_ profile: ProfileState) -> some View {
        HStack {
            Text(profile.name).font(.title2.bold())
            StatusPill(status: profile.status)
            Spacer()
        }
    }

    private func actions(_ profile: ProfileState) -> some View {
        HStack {
            Button("Launch headed") { runAction("launch-headed", profile) }
            Button("Open foreground") { runAction("open-foreground", profile) }
            Button("Stop daemon") { runAction("stop-daemon", profile) }
            Button("Kill profile", role: .destructive) { runAction("kill", profile) }
        }
        .buttonStyle(.bordered)
    }

    private func runAction(_ action: String, _ profile: ProfileState) {
        Task { await model.runAction(action, on: profile.name) }
    }

    private func runtimeFacts(_ profile: ProfileState) -> [(String, String)] {
        [
            ("PID", profile.pid.map(String.init) ?? "-"),
            ("Port", profile.port.map(String.init) ?? "-"),
            ("Launch mode", profile.launchMode ?? "-"),
            ("Active tabs", profile.activeTabs.map(String.init) ?? "-"),
            ("Paused", (profile.paused ?? false) ? "yes" : "no"),
            ("Disk usage", ByteFormatter.format(profile.diskUsageBytes)),
            ("User data dir", profile.userDataDir ?? "-"),
            ("Reason", profile.reason ?? "-"),
        ]
    }

    private func activityFacts(_ profile: ProfileState) -> [(String, String)] {
        [
            ("Daemon status", profile.daemon?.status ?? "-"),
            ("Daemon sessions", profile.daemon?.sessions.map(String.init) ?? "-"),
            ("Daemon mode", profile.daemon?.mode ?? "-"),
        ]
    }

    private func factsSection(title: String, rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
                .foregroundStyle(DesignTokens.inkSubtle)
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                ForEach(rows, id: \.0) { row in
                    GridRow {
                        Text(row.0).foregroundStyle(DesignTokens.inkSubtle)
                        Text(row.1)
                    }
                }
            }
        }
    }
}
