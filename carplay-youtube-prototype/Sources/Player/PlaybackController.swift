import AVFoundation
import UIKit

/// Owns the single `YouTubePlayerView` instance for the whole app.
///
/// There is deliberately only one player. A `UIView` can live in one view hierarchy
/// at a time, so when the CarPlay display connects the same view is re-parented into
/// the car window and the phone shows a placeholder. Two players would mean two
/// audio streams and two sets of ad impressions.
final class PlaybackController: NSObject {

    static let shared = PlaybackController()

    private(set) var queue: [Video] = []
    private(set) var currentIndex: Int?
    private(set) var state: YouTubePlayerState = .unstarted
    private(set) var currentTime: TimeInterval = 0
    private(set) var duration: TimeInterval = 0

    var currentVideo: Video? {
        guard let currentIndex, queue.indices.contains(currentIndex) else { return nil }
        return queue[currentIndex]
    }

    var isPlaying: Bool { state == .playing || state == .buffering }

    private(set) lazy var playerView: YouTubePlayerView = {
        let view = YouTubePlayerView(frame: .zero)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.delegate = self
        return view
    }()

    private override init() {
        super.init()
        configureAudioSession()
        NowPlayingController.shared.start()
    }

    private func configureAudioSession() {
        do {
            // `.playback` keeps audio alive when the phone locks, which is what
            // happens the moment the app is driving a car display.
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[PlaybackController] Audio session error: \(error)")
        }
    }

    // MARK: - View hosting

    /// Moves the player into `container`, filling it. Safe to call repeatedly.
    func attachPlayer(to container: UIView) {
        guard playerView.superview !== container else { return }
        playerView.removeFromSuperview()
        container.addSubview(playerView)
        NSLayoutConstraint.activate([
            playerView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            playerView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            playerView.topAnchor.constraint(equalTo: container.topAnchor),
            playerView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        NotificationCenter.default.post(name: .playerHostDidChange, object: nil)
    }

    /// True when the player is currently rendered on a screen other than the phone.
    var isPlayingOnExternalDisplay: Bool {
        guard let window = playerView.window else { return false }
        return window.screen !== UIScreen.main
    }

    // MARK: - Transport

    func play(_ video: Video, in queue: [Video]) {
        self.queue = queue
        self.currentIndex = queue.firstIndex(of: video) ?? 0
        currentTime = 0
        duration = TimeInterval(video.durationSeconds)
        playerView.load(videoID: video.id)
        broadcast()
    }

    func togglePlayPause() {
        isPlaying ? playerView.pause() : playerView.play()
    }

    func play() { playerView.play() }

    func pause() { playerView.pause() }

    func seek(to seconds: TimeInterval) {
        playerView.seek(to: seconds)
    }

    func skipForward(_ interval: TimeInterval = 15) {
        seek(to: currentTime + interval)
    }

    func skipBackward(_ interval: TimeInterval = 15) {
        seek(to: max(0, currentTime - interval))
    }

    @discardableResult
    func next() -> Bool {
        guard let currentIndex, currentIndex + 1 < queue.count else { return false }
        play(queue[currentIndex + 1], in: queue)
        return true
    }

    @discardableResult
    func previous() -> Bool {
        // Match the usual transport convention: restart the current item unless we
        // are already near its beginning.
        if currentTime > 3 {
            seek(to: 0)
            return true
        }
        guard let currentIndex, currentIndex - 1 >= 0 else { return false }
        play(queue[currentIndex - 1], in: queue)
        return true
    }

    private func broadcast() {
        NotificationCenter.default.post(name: .playbackDidChange, object: nil)
        NowPlayingController.shared.update(with: self)
    }
}

extension PlaybackController: YouTubePlayerViewDelegate {

    func playerViewDidBecomeReady(_ view: YouTubePlayerView) {
        if let currentVideo, view.currentVideoID != currentVideo.id {
            view.load(videoID: currentVideo.id)
        }
    }

    func playerView(_ view: YouTubePlayerView, didChangeState state: YouTubePlayerState) {
        self.state = state
        if state == .ended {
            // Auto-advance so a queue keeps playing while the phone is stowed.
            if next() { return }
        }
        broadcast()
    }

    func playerView(_ view: YouTubePlayerView, didUpdateTime time: TimeInterval, duration: TimeInterval) {
        currentTime = time
        if duration > 0 { self.duration = duration }
        broadcast()
    }

    func playerView(_ view: YouTubePlayerView, didFailWithCode code: Int) {
        NSLog("[PlaybackController] Player error \(code) for \(currentVideo?.id ?? "nil")")
        NotificationCenter.default.post(name: .playbackDidFail,
                                        object: nil,
                                        userInfo: ["code": code])
    }
}

extension Notification.Name {
    static let playbackDidChange = Notification.Name("PlaybackDidChange")
    static let playbackDidFail = Notification.Name("PlaybackDidFail")
    static let playerHostDidChange = Notification.Name("PlayerHostDidChange")
}
