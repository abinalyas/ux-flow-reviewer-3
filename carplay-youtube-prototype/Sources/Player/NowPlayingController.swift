import Foundation
import MediaPlayer
import UIKit

/// Publishes transport metadata to the system and wires up the remote commands that
/// steering-wheel buttons and the car's head unit send back.
///
/// This is the part of the prototype that behaves identically on real CarPlay
/// hardware — `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` need no
/// entitlement.
final class NowPlayingController {

    static let shared = NowPlayingController()

    private var started = false
    private var artworkCache: [String: MPMediaItemArtwork] = [:]

    private init() {}

    func start() {
        guard !started else { return }
        started = true

        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { _ in
            PlaybackController.shared.play()
            return .success
        }
        center.pauseCommand.addTarget { _ in
            PlaybackController.shared.pause()
            return .success
        }
        center.togglePlayPauseCommand.addTarget { _ in
            PlaybackController.shared.togglePlayPause()
            return .success
        }
        center.nextTrackCommand.addTarget { _ in
            PlaybackController.shared.next() ? .success : .noSuchContent
        }
        center.previousTrackCommand.addTarget { _ in
            PlaybackController.shared.previous() ? .success : .noSuchContent
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { event in
            let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
            PlaybackController.shared.skipForward(interval)
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { event in
            let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
            PlaybackController.shared.skipBackward(interval)
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            PlaybackController.shared.seek(to: event.positionTime)
            return .success
        }
    }

    func update(with controller: PlaybackController) {
        guard let video = controller.currentVideo else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: video.title,
            MPMediaItemPropertyArtist: video.channel,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: controller.currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: controller.isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyIsLiveStream: false
        ]
        if controller.duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = controller.duration
        }
        // Carry the existing artwork across the frequent progress updates; only
        // re-download when the track itself changed.
        if let artwork = artworkCache[video.id] {
            info[MPMediaItemPropertyArtwork] = artwork
        } else {
            loadArtwork(for: video)
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(for video: Video) {
        guard let url = video.thumbnailURL else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self?.artworkCache[video.id] = artwork
                // Bail if the track changed while the thumbnail was downloading.
                guard PlaybackController.shared.currentVideo?.id == video.id else { return }
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }
}
