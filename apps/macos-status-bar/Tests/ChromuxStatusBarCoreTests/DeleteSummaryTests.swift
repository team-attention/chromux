import Testing
@testable import ChromuxStatusBarCore

struct DeleteSummaryTests {
    @Test func nameListUnderLimitShowsAllNames() {
        let names = ["a", "b", "c"]
        #expect(DeleteSummary.nameList(names) == "a, b, c")
    }

    @Test func nameListAtLimitShowsAllNames() {
        let names = (1...6).map { "profile-\($0)" }
        #expect(DeleteSummary.nameList(names) == names.joined(separator: ", "))
    }

    @Test func nameListOverLimitTruncatesWithAndNMore() {
        let names = (1...9).map { "profile-\($0)" }
        let expectedPreview = (1...6).map { "profile-\($0)" }.joined(separator: ", ")
        #expect(DeleteSummary.nameList(names) == "\(expectedPreview) and 3 more")
    }

    @Test func confirmationMessageSingularVsPlural() {
        #expect(DeleteSummary.confirmationMessage(names: ["alpha"]).contains("Delete 1 profile "))
        #expect(DeleteSummary.confirmationMessage(names: ["alpha", "beta"]).contains("Delete 2 profiles "))
    }

    @Test func resultMessageAllSucceeded() {
        let message = DeleteSummary.resultMessage(succeededNames: ["alpha", "beta"], failedNames: [])
        #expect(message == "Deleted 2 profiles.")
    }

    @Test func resultMessageSingleSucceeded() {
        let message = DeleteSummary.resultMessage(succeededNames: ["alpha"], failedNames: [])
        #expect(message == "Deleted 1 profile.")
    }

    @Test func resultMessageReportsSucceededAndFailedByName() {
        let message = DeleteSummary.resultMessage(succeededNames: ["alpha"], failedNames: ["beta", "gamma"])
        #expect(message == "1 succeeded, 2 failed: beta, gamma")
    }
}
