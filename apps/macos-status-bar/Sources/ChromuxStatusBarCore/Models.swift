import Foundation

public struct DaemonState: Codable, Equatable, Sendable {
    public let status: String
    public let sessions: Int?
    public let mode: String?
    public let paused: Bool?
    public let error: String?

    public init(status: String, sessions: Int? = nil, mode: String? = nil, paused: Bool? = nil, error: String? = nil) {
        self.status = status
        self.sessions = sessions
        self.mode = mode
        self.paused = paused
        self.error = error
    }
}

public struct ProfileState: Codable, Equatable, Identifiable, Sendable {
    public let name: String
    public let status: String
    public let reason: String?
    public let pid: Int?
    public let port: Int?
    public let launchMode: String?
    public let headless: Bool?
    public let source: String?
    public let userDataDir: String?
    public let modifiedAt: String?
    public let diskUsageBytes: Int64?
    public let daemon: DaemonState?
    public let activeTabs: Int?
    public let paused: Bool?

    public var id: String { name }

    public init(
        name: String,
        status: String,
        reason: String? = nil,
        pid: Int? = nil,
        port: Int? = nil,
        launchMode: String? = nil,
        headless: Bool? = nil,
        source: String? = nil,
        userDataDir: String? = nil,
        modifiedAt: String? = nil,
        diskUsageBytes: Int64? = nil,
        daemon: DaemonState? = nil,
        activeTabs: Int? = nil,
        paused: Bool? = nil
    ) {
        self.name = name
        self.status = status
        self.reason = reason
        self.pid = pid
        self.port = port
        self.launchMode = launchMode
        self.headless = headless
        self.source = source
        self.userDataDir = userDataDir
        self.modifiedAt = modifiedAt
        self.diskUsageBytes = diskUsageBytes
        self.daemon = daemon
        self.activeTabs = activeTabs
        self.paused = paused
    }
}

public struct StatusState: Codable, Equatable, Sendable {
    public let ok: Bool?
    public let generatedAt: String?
    public let chromuxHome: String?
    public let profiles: [ProfileState]

    public init(ok: Bool? = nil, generatedAt: String? = nil, chromuxHome: String? = nil, profiles: [ProfileState]) {
        self.ok = ok
        self.generatedAt = generatedAt
        self.chromuxHome = chromuxHome
        self.profiles = profiles
    }
}

public struct ProfileActionResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let code: Int?
    public let stdout: String?
    public let stderr: String?
}

public struct ProfileActionResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let action: String
    public let profile: String
    public let result: ProfileActionResult?
}

public struct ProfileDeleteResultEntry: Codable, Equatable, Sendable {
    public let profile: String
    public let ok: Bool
    public let killed: Bool?
    public let removed: Bool
    public let error: String?
}

public struct ProfileDeleteResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let deleted: Int
    public let failed: Int
    public let results: [ProfileDeleteResultEntry]
}
