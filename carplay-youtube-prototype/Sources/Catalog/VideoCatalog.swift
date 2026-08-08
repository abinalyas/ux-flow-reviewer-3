import Foundation

/// Source of the browsable video list.
///
/// Ships with a bundled `catalog.json` so the prototype runs with zero configuration.
/// If a `YouTubeAPIKey` is present in the app's Info.plist, `search(_:)` will hit the
/// YouTube Data API v3 instead. See README for how to supply the key without
/// committing it.
final class VideoCatalog {

    static let shared = VideoCatalog()

    private(set) var videos: [Video] = []

    private var apiKey: String? {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "YouTubeAPIKey") as? String,
              !key.isEmpty,
              key != "$(YOUTUBE_API_KEY)" else { return nil }
        return key
    }

    var isSearchAvailable: Bool { apiKey != nil }

    private init() {
        videos = Self.loadBundledCatalog()
    }

    private static func loadBundledCatalog() -> [Video] {
        guard let url = Bundle.main.url(forResource: "catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode(VideoList.self, from: data) else {
            assertionFailure("catalog.json missing from bundle")
            return []
        }
        return list.videos
    }

    /// Replaces the catalog with bundled contents. Used to reset after a search.
    func resetToBundled() {
        videos = Self.loadBundledCatalog()
        NotificationCenter.default.post(name: .catalogDidChange, object: nil)
    }

    /// Searches YouTube. No-ops (calling back with a failure) when no API key is configured.
    func search(_ query: String, completion: @escaping (Result<[Video], Error>) -> Void) {
        guard let apiKey else {
            completion(.failure(CatalogError.noAPIKey))
            return
        }
        guard var components = URLComponents(string: "https://www.googleapis.com/youtube/v3/search") else {
            completion(.failure(CatalogError.badResponse))
            return
        }
        components.queryItems = [
            URLQueryItem(name: "part", value: "snippet"),
            URLQueryItem(name: "type", value: "video"),
            URLQueryItem(name: "maxResults", value: "25"),
            URLQueryItem(name: "videoEmbeddable", value: "true"),
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "key", value: apiKey)
        ]
        guard let url = components.url else {
            completion(.failure(CatalogError.badResponse))
            return
        }

        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            if let error {
                DispatchQueue.main.async { completion(.failure(error)) }
                return
            }
            guard let data,
                  let payload = try? JSONDecoder().decode(SearchResponse.self, from: data) else {
                DispatchQueue.main.async { completion(.failure(CatalogError.badResponse)) }
                return
            }
            // The search endpoint does not return durations; contentDetails needs a
            // second `videos.list` call. The prototype shows 0:00 rather than paying
            // for that extra quota.
            let results = payload.items.compactMap { item -> Video? in
                guard let videoId = item.id.videoId else { return nil }
                return Video(id: videoId,
                             title: item.snippet.title,
                             channel: item.snippet.channelTitle,
                             durationSeconds: 0)
            }
            DispatchQueue.main.async {
                self?.videos = results
                NotificationCenter.default.post(name: .catalogDidChange, object: nil)
                completion(.success(results))
            }
        }.resume()
    }

    enum CatalogError: LocalizedError {
        case noAPIKey
        case badResponse

        var errorDescription: String? {
            switch self {
            case .noAPIKey:
                return "No YouTube API key configured — using the bundled catalog."
            case .badResponse:
                return "YouTube returned an unexpected response."
            }
        }
    }

    private struct SearchResponse: Decodable {
        struct Item: Decodable {
            struct ID: Decodable { let videoId: String? }
            struct Snippet: Decodable {
                let title: String
                let channelTitle: String
            }
            let id: ID
            let snippet: Snippet
        }
        let items: [Item]
    }
}

extension Notification.Name {
    static let catalogDidChange = Notification.Name("CatalogDidChange")
}
