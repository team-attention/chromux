import Foundation
import ChromuxStatusBarCore

enum APIClientError: Error, LocalizedError {
    case invalidResponse
    case http(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from local chromux server."
        case .http(let status, let message):
            return "HTTP \(status): \(message)"
        }
    }
}

struct APIClient {
    let baseURL: URL

    private var decoder: JSONDecoder {
        JSONDecoder()
    }

    func fetchState() async throws -> StatusState {
        let (data, response) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/state"))
        try Self.checkOK(data: data, response: response)
        return try decoder.decode(StatusState.self, from: data)
    }

    func deleteProfiles(_ names: [String]) async throws -> ProfileDeleteResponse {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/profiles/delete"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["profiles": names])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response, allowNon2xxBody: true)
        return try decoder.decode(ProfileDeleteResponse.self, from: data)
    }

    func runProfileAction(profile: String, action: String) async throws -> ProfileActionResponse {
        guard let encodedName = profile.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw APIClientError.invalidResponse
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/profiles/\(encodedName)/action"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["action": action])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkOK(data: data, response: response, allowNon2xxBody: true)
        return try decoder.decode(ProfileActionResponse.self, from: data)
    }

    /// The delete and action endpoints return a structured `{ ok, ... }` body even on non-2xx
    /// (e.g. partial-failure 409), so only throw on transport-level failures or a missing body.
    private static func checkOK(data: Data, response: URLResponse, allowNon2xxBody: Bool = false) throws {
        guard let http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        if (200..<300).contains(http.statusCode) { return }
        if allowNon2xxBody, !data.isEmpty { return }
        let message = String(data: data, encoding: .utf8) ?? "no body"
        throw APIClientError.http(status: http.statusCode, message: message)
    }
}
