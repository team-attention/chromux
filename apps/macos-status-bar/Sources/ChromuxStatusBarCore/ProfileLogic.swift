import Foundation

public enum ProfileStatusFilter: String, CaseIterable, Sendable {
    case all
    case active
    case stopped
}

public enum ProfileLogic {
    /// Mirrors `isProfileActive()` in status-app/app.js.
    public static func isActive(_ profile: ProfileState) -> Bool {
        if profile.status == "running" { return true }
        if (profile.activeTabs ?? 0) > 0 { return true }
        if profile.daemon?.status == "ok" || profile.daemon?.status == "running" { return true }
        return false
    }

    /// Mirrors `profileSortRank()` in status-app/app.js.
    public static func sortRank(_ profile: ProfileState) -> Int {
        if isActive(profile) { return 0 }
        if profile.status == "stale" { return 1 }
        if profile.status == "error" { return 2 }
        return 3
    }

    /// Mirrors `orderedProfiles()` in status-app/app.js: active-first, then by rank, then by name.
    public static func ordered(_ profiles: [ProfileState]) -> [ProfileState] {
        profiles.sorted { a, b in
            let rankDelta = sortRank(a) - sortRank(b)
            if rankDelta != 0 { return rankDelta < 0 }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }

    /// Mirrors `visibleProfiles()` in status-app/app.js: ordered, then status-filtered, then search-filtered.
    public static func visible(
        _ profiles: [ProfileState],
        search: String,
        statusFilter: ProfileStatusFilter
    ) -> [ProfileState] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ordered(profiles).filter { profile in
            let active = isActive(profile)
            if statusFilter == .active && !active { return false }
            if statusFilter == .stopped && active { return false }
            if query.isEmpty { return true }
            let haystack = [profile.name, profile.status, profile.daemon?.status, profile.userDataDir]
                .compactMap { $0 }
            return haystack.contains { $0.lowercased().contains(query) }
        }
    }
}

public enum ByteFormatter {
    /// Mirrors `fmtBytes()` in status-app/app.js.
    public static func format(_ value: Int64?) -> String {
        guard let value, value >= 0 else { return "-" }
        if value < 1024 { return "\(value) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var size = Double(value)
        var unitIndex = -1
        repeat {
            size /= 1024
            unitIndex += 1
        } while size >= 1024 && unitIndex < units.count - 1
        let rounded = size >= 100 ? String(Int(size.rounded())) : String(format: "%.1f", size)
        return "\(rounded) \(units[unitIndex])"
    }
}
