import UIKit

/// Browsable list of videos, used unchanged on both the phone and the car display.
///
/// Row height and font sizes are deliberately generous — the car build is meant to
/// be legible at a glance, and reusing one list keeps the two surfaces in sync.
final class VideoListViewController: UIViewController {

    var onSelect: ((Video) -> Void)?

    private let tableView = UITableView(frame: .zero, style: .plain)
    private var videos: [Video] = []
    private var highlightedID: String?
    private var thumbnailTasks: [IndexPath: URLSessionDataTask] = [:]
    private var thumbnailCache: [String: UIImage] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.backgroundColor = .clear
        tableView.separatorStyle = .none
        tableView.rowHeight = 76
        tableView.dataSource = self
        tableView.delegate = self
        tableView.register(VideoCell.self, forCellReuseIdentifier: VideoCell.reuseID)
        view.addSubview(tableView)

        NSLayoutConstraint.activate([
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        NotificationCenter.default.addObserver(
            self, selector: #selector(catalogDidChange),
            name: .catalogDidChange, object: nil
        )

        videos = VideoCatalog.shared.videos
        tableView.reloadData()
    }

    @objc private func catalogDidChange() {
        videos = VideoCatalog.shared.videos
        tableView.reloadData()
    }

    func highlight(videoID: String?) {
        guard highlightedID != videoID else { return }
        highlightedID = videoID
        tableView.reloadData()
    }
}

extension VideoListViewController: UITableViewDataSource, UITableViewDelegate {

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        videos.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: VideoCell.reuseID, for: indexPath)
        guard let cell = cell as? VideoCell else { return cell }
        let video = videos[indexPath.row]
        cell.configure(with: video, isCurrent: video.id == highlightedID)
        cell.thumbnailView.image = thumbnailCache[video.id]
        if thumbnailCache[video.id] == nil {
            loadThumbnail(for: video, at: indexPath)
        }
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        onSelect?(videos[indexPath.row])
    }

    func tableView(_ tableView: UITableView, didEndDisplaying cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        thumbnailTasks[indexPath]?.cancel()
        thumbnailTasks[indexPath] = nil
    }

    private func loadThumbnail(for video: Video, at indexPath: IndexPath) {
        guard let url = video.thumbnailURL else { return }
        thumbnailTasks[indexPath]?.cancel()
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self else { return }
                self.thumbnailCache[video.id] = image
                // Only touch the row if it still shows this video.
                guard self.videos.indices.contains(indexPath.row),
                      self.videos[indexPath.row].id == video.id,
                      let cell = self.tableView.cellForRow(at: indexPath) as? VideoCell else { return }
                cell.thumbnailView.image = image
            }
        }
        thumbnailTasks[indexPath] = task
        task.resume()
    }
}

// MARK: - Cell

private final class VideoCell: UITableViewCell {

    static let reuseID = "VideoCell"

    let thumbnailView = UIImageView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let nowPlayingDot = UIView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        selectionStyle = .default

        thumbnailView.translatesAutoresizingMaskIntoConstraints = false
        thumbnailView.contentMode = .scaleAspectFill
        thumbnailView.clipsToBounds = true
        thumbnailView.layer.cornerRadius = 6
        thumbnailView.backgroundColor = UIColor.white.withAlphaComponent(0.1)
        contentView.addSubview(thumbnailView)

        titleLabel.font = .systemFont(ofSize: 17, weight: .medium)
        titleLabel.numberOfLines = 2

        subtitleLabel.font = .systemFont(ofSize: 13)
        subtitleLabel.textColor = .secondaryLabel

        let stack = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        stack.axis = .vertical
        stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)

        nowPlayingDot.translatesAutoresizingMaskIntoConstraints = false
        nowPlayingDot.backgroundColor = .systemGreen
        nowPlayingDot.layer.cornerRadius = 4
        nowPlayingDot.isHidden = true
        contentView.addSubview(nowPlayingDot)

        NSLayoutConstraint.activate([
            thumbnailView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            thumbnailView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            thumbnailView.widthAnchor.constraint(equalToConstant: 96),
            thumbnailView.heightAnchor.constraint(equalToConstant: 54),

            stack.leadingAnchor.constraint(equalTo: thumbnailView.trailingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: nowPlayingDot.leadingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),

            nowPlayingDot.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            nowPlayingDot.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            nowPlayingDot.widthAnchor.constraint(equalToConstant: 8),
            nowPlayingDot.heightAnchor.constraint(equalToConstant: 8)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(with video: Video, isCurrent: Bool) {
        titleLabel.text = video.title
        subtitleLabel.text = video.durationSeconds > 0
            ? "\(video.channel) · \(video.formattedDuration)"
            : video.channel
        nowPlayingDot.isHidden = !isCurrent
        titleLabel.textColor = isCurrent ? .systemGreen : .label
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        thumbnailView.image = nil
    }
}
