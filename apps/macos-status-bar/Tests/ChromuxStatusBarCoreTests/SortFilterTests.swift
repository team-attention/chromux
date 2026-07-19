import Testing
@testable import ChromuxStatusBarCore

struct SortFilterTests {
    private func profile(
        _ name: String,
        status: String = "stopped",
        activeTabs: Int? = nil,
        daemonStatus: String? = nil,
        userDataDir: String? = nil
    ) -> ProfileState {
        ProfileState(
            name: name,
            status: status,
            userDataDir: userDataDir,
            daemon: daemonStatus.map { DaemonState(status: $0) },
            activeTabs: activeTabs
        )
    }

    @Test func isActiveByStatus() {
        #expect(ProfileLogic.isActive(profile("a", status: "running")))
    }

    @Test func isActiveByActiveTabs() {
        #expect(ProfileLogic.isActive(profile("a", status: "stopped", activeTabs: 1)))
        #expect(!ProfileLogic.isActive(profile("a", status: "stopped", activeTabs: 0)))
    }

    @Test func isActiveByDaemonStatus() {
        #expect(ProfileLogic.isActive(profile("a", daemonStatus: "ok")))
        #expect(ProfileLogic.isActive(profile("a", daemonStatus: "running")))
        #expect(!ProfileLogic.isActive(profile("a", daemonStatus: "stale")))
    }

    @Test func orderedProfilesActiveFirstThenRankThenName() {
        let profiles = [
            profile("zeta", status: "error"),
            profile("beta", status: "running"),
            profile("alpha", status: "stale"),
            profile("delta", status: "running"),
            profile("charlie", status: "stopped"),
        ]
        let ordered = ProfileLogic.ordered(profiles).map(\.name)
        #expect(ordered == ["beta", "delta", "alpha", "zeta", "charlie"])
    }

    @Test func visibleFiltersByStatus() {
        let profiles = [
            profile("running-one", status: "running"),
            profile("stopped-one", status: "stopped"),
        ]
        let activeOnly = ProfileLogic.visible(profiles, search: "", statusFilter: .active).map(\.name)
        #expect(activeOnly == ["running-one"])

        let stoppedOnly = ProfileLogic.visible(profiles, search: "", statusFilter: .stopped).map(\.name)
        #expect(stoppedOnly == ["stopped-one"])
    }

    @Test func visibleFiltersBySearchAcrossFields() {
        let profiles = [
            profile("alpha", status: "running", userDataDir: "/Users/x/.chromux/profiles/alpha"),
            profile("beta", status: "stopped", userDataDir: "/Users/x/.chromux/profiles/beta"),
        ]
        let byName = ProfileLogic.visible(profiles, search: "ALPHA", statusFilter: .all).map(\.name)
        #expect(byName == ["alpha"])

        let byPath = ProfileLogic.visible(profiles, search: "profiles/beta", statusFilter: .all).map(\.name)
        #expect(byPath == ["beta"])
    }

    @Test func byteFormatterMatchesJsRules() {
        #expect(ByteFormatter.format(nil) == "-")
        #expect(ByteFormatter.format(-1) == "-")
        #expect(ByteFormatter.format(512) == "512 B")
        #expect(ByteFormatter.format(2048) == "2.0 KB")
        #expect(ByteFormatter.format(150 * 1024 * 1024) == "150 MB")
    }
}
