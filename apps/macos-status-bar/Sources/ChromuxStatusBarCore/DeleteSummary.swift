import Foundation

public enum DeleteSummary {
    /// Mirrors the delete-confirmation name-list truncation in status-app/app.js:
    /// the first 6 names, then " and N more" for the remainder.
    public static func nameList(_ names: [String], limit: Int = 6) -> String {
        guard !names.isEmpty else { return "" }
        let preview = names.prefix(limit).joined(separator: ", ")
        let remaining = names.count - limit
        guard remaining > 0 else { return preview }
        return "\(preview) and \(remaining) more"
    }

    /// Confirmation dialog body text for a pending bulk delete.
    public static func confirmationMessage(names: [String]) -> String {
        let count = names.count
        let noun = count == 1 ? "profile" : "profiles"
        return "Delete \(count) \(noun) and local profile files?\n\n\(nameList(names))"
    }

    /// Result summary after a bulk delete: succeeded/failed counts by name, not a bare HTTP status.
    public static func resultMessage(succeededNames: [String], failedNames: [String]) -> String {
        if failedNames.isEmpty {
            let count = succeededNames.count
            return "Deleted \(count) profile\(count == 1 ? "" : "s")."
        }
        return "\(succeededNames.count) succeeded, \(failedNames.count) failed: \(nameList(failedNames))"
    }
}
