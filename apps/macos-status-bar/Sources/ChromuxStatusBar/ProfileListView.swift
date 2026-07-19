import SwiftUI
import ChromuxStatusBarCore

/// Native profile list: search, status filter, active-first sort, multi-select bulk delete (R3, R4, AC4, AC5).
struct ProfileListView: View {
    @ObservedObject var model: AppModel

    private var visible: [ProfileState] { model.visibleProfiles }
    private var allSelected: Bool {
        !visible.isEmpty && visible.allSatisfy { model.selectedForBulk.contains($0.name) }
    }
    private var someSelected: Bool {
        visible.contains { model.selectedForBulk.contains($0.name) } && !allSelected
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(DesignTokens.hairline)
            if !model.selectedForBulk.isEmpty {
                bulkBar
                Divider().background(DesignTokens.hairline)
            }
            list
        }
        .background(DesignTokens.surface1)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Search profiles", text: $model.searchText)
                .textFieldStyle(.roundedBorder)

            Picker("Status", selection: $model.statusFilter) {
                Text("All").tag(ProfileStatusFilter.all)
                Text("Active").tag(ProfileStatusFilter.active)
                Text("Stopped").tag(ProfileStatusFilter.stopped)
            }
            .pickerStyle(.segmented)
        }
        .padding(12)
    }

    private var bulkBar: some View {
        HStack {
            Toggle(isOn: Binding(
                get: { allSelected },
                set: { isOn in toggleSelectAll(isOn) }
            )) {
                EmptyView()
            }
            .toggleStyle(.checkbox)

            Text("\(model.selectedForBulk.count) / \(visible.count) selected")
                .font(.caption)
                .foregroundStyle(DesignTokens.inkSubtle)

            Spacer()

            Button("Delete", role: .destructive) {
                model.requestBulkDelete()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var list: some View {
        List(selection: $model.selectedProfileName) {
            if visible.isEmpty {
                Text(model.profiles.isEmpty ? "No profiles" : "No matching profiles")
                    .foregroundStyle(DesignTokens.inkSubtle)
            } else {
                ForEach(visible) { profile in
                    ProfileRow(
                        profile: profile,
                        isSelectedForBulk: model.selectedForBulk.contains(profile.name),
                        onToggleBulk: { toggleBulk(profile.name) }
                    )
                    .tag(profile.name)
                }
            }
        }
        .listStyle(.sidebar)
        .confirmationDialog(
            "Delete Profiles",
            isPresented: Binding(
                get: { model.pendingDeleteNames != nil },
                set: { if !$0 { model.cancelPendingDelete() } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await model.confirmPendingDelete() }
            }
            Button("Cancel", role: .cancel) {
                model.cancelPendingDelete()
            }
        } message: {
            Text(DeleteSummary.confirmationMessage(names: model.pendingDeleteNames ?? []))
        }
    }

    private func toggleBulk(_ name: String) {
        if model.selectedForBulk.contains(name) {
            model.selectedForBulk.remove(name)
        } else {
            model.selectedForBulk.insert(name)
        }
    }

    private func toggleSelectAll(_ isOn: Bool) {
        if isOn {
            model.selectedForBulk.formUnion(visible.map(\.name))
        } else {
            let names = Set(visible.map(\.name))
            model.selectedForBulk.subtract(names)
        }
    }
}

private struct ProfileRow: View {
    let profile: ProfileState
    let isSelectedForBulk: Bool
    let onToggleBulk: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Toggle(isOn: Binding(get: { isSelectedForBulk }, set: { _ in onToggleBulk() })) {
                EmptyView()
            }
            .toggleStyle(.checkbox)

            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name).font(.body)
                Text(metaLine)
                    .font(.caption)
                    .foregroundStyle(DesignTokens.inkSubtle)
            }

            Spacer()

            StatusPill(status: profile.status)
        }
        .padding(.vertical, 2)
    }

    private var metaLine: String {
        let daemon = profile.daemon?.status ?? "-"
        let tabs = profile.activeTabs.map(String.init) ?? "-"
        return "\(daemon) daemon / \(tabs) tabs / \(ByteFormatter.format(profile.diskUsageBytes))"
    }
}

struct StatusPill: View {
    let status: String

    private var color: Color {
        switch status {
        case "running": return DesignTokens.semanticSuccess
        case "stale": return .orange
        case "error": return .red
        default: return DesignTokens.inkSubtle
        }
    }

    var body: some View {
        Text(status)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}
