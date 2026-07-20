import Foundation
import Testing
@testable import ChromuxStatusBarCore

struct DecodingTests {
    @Test func decodesFullProfileState() throws {
        let json = """
        {
          "ok": true,
          "generatedAt": "2026-07-19T00:00:00.000Z",
          "chromuxHome": "/Users/test/.chromux",
          "profiles": [
            {
              "name": "alpha",
              "status": "running",
              "reason": null,
              "pid": 4242,
              "port": 9333,
              "launchMode": "headed",
              "headless": false,
              "source": "daemon",
              "userDataDir": "/Users/test/.chromux/profiles/alpha",
              "modifiedAt": "2026-07-18T12:00:00.000Z",
              "diskUsageBytes": 104857600,
              "daemon": { "status": "ok", "sessions": 2, "mode": "default", "paused": false },
              "activeTabs": 3,
              "paused": false
            }
          ]
        }
        """.data(using: .utf8)!

        let state = try JSONDecoder().decode(StatusState.self, from: json)
        #expect(state.profiles.count == 1)
        let profile = state.profiles[0]
        #expect(profile.name == "alpha")
        #expect(profile.status == "running")
        #expect(profile.pid == 4242)
        #expect(profile.port == 9333)
        #expect(profile.activeTabs == 3)
        #expect(profile.diskUsageBytes == 104_857_600)
        #expect(profile.daemon?.status == "ok")
        #expect(profile.daemon?.sessions == 2)
    }

    @Test func decodesMinimalProfileStateWithNulls() throws {
        let json = """
        {
          "profiles": [
            { "name": "beta", "status": "stopped" }
          ]
        }
        """.data(using: .utf8)!

        let state = try JSONDecoder().decode(StatusState.self, from: json)
        let profile = state.profiles[0]
        #expect(profile.name == "beta")
        #expect(profile.status == "stopped")
        #expect(profile.pid == nil)
        #expect(profile.daemon == nil)
        #expect(profile.activeTabs == nil)
    }

    @Test func decodesProfileDeleteResponse() throws {
        let json = """
        {
          "ok": false,
          "deleted": 1,
          "failed": 1,
          "results": [
            { "profile": "alpha", "ok": true, "killed": true, "removed": true },
            { "profile": "beta", "ok": false, "removed": false, "error": "boom" }
          ]
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(ProfileDeleteResponse.self, from: json)
        #expect(!response.ok)
        #expect(response.deleted == 1)
        #expect(response.failed == 1)
        #expect(response.results.count == 2)
        #expect(response.results[1].error == "boom")
    }

    @Test func decodesProfileActionResponse() throws {
        let json = """
        {
          "ok": true,
          "action": "kill",
          "profile": "alpha",
          "result": { "ok": true, "code": 0, "stdout": "done", "stderr": "" }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(ProfileActionResponse.self, from: json)
        #expect(response.action == "kill")
        #expect(response.result?.stdout == "done")
    }
}
