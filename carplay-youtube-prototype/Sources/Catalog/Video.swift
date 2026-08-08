import Foundation

/// A single playable YouTube item.
struct Video: Codable, Hashable, Identifiable {
    /// The YouTube video id (the `v=` parameter), e.g. `aqz-KE-bpKQ`.
    let id: String
    let title: String
    let channel: String
    let durationSeconds: Int

    /// Thumbnail served by YouTube's image CDN. `hqdefault` exists for every video.
    var thumbnailURL: URL? {
        URL(string: "https://i.ytimg.com/vi/\(id)/hqdefault.jpg")
    }

    var formattedDuration: String {
        let minutes = durationSeconds / 60
        let seconds = durationSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

struct VideoList: Codable {
    let videos: [Video]
}
