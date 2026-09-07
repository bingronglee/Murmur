import AVFoundation
import Combine
import Foundation
import WatchConnectivity

final class WatchRecordingManager: NSObject, ObservableObject {
    static let shared = WatchRecordingManager()

    @Published private(set) var isRecording = false
    @Published private(set) var isProcessing = false
    @Published private(set) var elapsedText = "00:00"
    @Published private(set) var statusMessage = "準備錄音"
    @Published private(set) var pendingCount = 0

    private let fileManager = FileManager.default
    private let recordingDirectory: URL
    private let pendingDirectory: URL
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startedAt: Date?
    private var watchSession: WCSession?
    private var awaitingReceiptFilenames = Set<String>()

    private override init() {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        recordingDirectory = documents.appendingPathComponent("RecordingVoiceNotes", isDirectory: true)
        pendingDirectory = documents.appendingPathComponent("PendingVoiceNotes", isDirectory: true)
        super.init()

        try? fileManager.createDirectory(
            at: recordingDirectory,
            withIntermediateDirectories: true
        )
        try? fileManager.createDirectory(
            at: pendingDirectory,
            withIntermediateDirectories: true
        )
        configureWatchConnectivity()
        refreshPendingCount()
    }

    func toggleRecording() {
        guard !isProcessing else { return }
        isProcessing = true

        if isRecording {
            statusMessage = "正在保存錄音…"
            stopRecording()
        } else {
            statusMessage = "正在準備錄音…"
            requestPermissionAndStart()
        }
    }

    private func requestPermissionAndStart() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            configureAndStartRecording()
        case .denied:
            statusMessage = "請在設定中允許麥克風"
            isProcessing = false
        case .undetermined:
            AVAudioApplication.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.configureAndStartRecording()
                    } else {
                        self?.statusMessage = "未取得麥克風權限"
                        self?.isProcessing = false
                    }
                }
            }
        @unknown default:
            statusMessage = "無法確認麥克風權限"
            isProcessing = false
        }
    }

    private func configureAndStartRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .default)
            audioSession.activate(options: []) { [weak self] activated, error in
                DispatchQueue.main.async {
                    guard activated, error == nil else {
                        self?.statusMessage = "無法啟用錄音：\(error?.localizedDescription ?? "未知錯誤")"
                        self?.isProcessing = false
                        return
                    }
                    self?.startRecorder()
                }
            }
        } catch {
            statusMessage = "錄音設定失敗：\(error.localizedDescription)"
            isProcessing = false
        }
    }

    private func startRecorder() {
        let filename = "watch-voice-\(UUID().uuidString).m4a"
        let destination = recordingDirectory.appendingPathComponent(filename)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        do {
            recorder = try AVAudioRecorder(url: destination, settings: settings)
            recorder?.delegate = self
            recorder?.prepareToRecord()
            guard recorder?.record() == true else {
                statusMessage = "無法開始錄音"
                isProcessing = false
                return
            }
            isRecording = true
            isProcessing = false
            statusMessage = "錄音中"
            startedAt = Date()
            startTimer()
        } catch {
            statusMessage = "建立錄音檔失敗：\(error.localizedDescription)"
            isProcessing = false
        }
    }

    private func stopRecording() {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let startedAt = self.startedAt else { return }
            let seconds = Int(Date().timeIntervalSince(startedAt))
            self.elapsedText = String(format: "%02d:%02d", seconds / 60, seconds % 60)
        }
    }

    private func configureWatchConnectivity() {
        guard WCSession.isSupported() else {
            statusMessage = "此手錶不支援同步"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        watchSession = session
    }

    private func enqueuePendingFiles() {
        guard let session = watchSession, session.activationState == .activated else {
            statusMessage = "錄音已保存，等待 iPhone 連線"
            return
        }

        let outstanding = Set(session.outstandingFileTransfers.map { $0.file.fileURL.lastPathComponent })
        let files = (try? fileManager.contentsOfDirectory(
            at: pendingDirectory,
            includingPropertiesForKeys: nil
        )) ?? []

        files
            .filter { $0.pathExtension.lowercased() == "m4a" }
            .filter { !outstanding.contains($0.lastPathComponent) }
            .filter { !awaitingReceiptFilenames.contains($0.lastPathComponent) }
            .forEach {
                session.transferFile($0, metadata: ["filename": $0.lastPathComponent])
            }
        statusMessage = files.isEmpty ? "準備錄音" : "等待同步到 iPhone"
    }

    private func refreshPendingCount() {
        pendingCount = ((try? fileManager.contentsOfDirectory(
            at: pendingDirectory,
            includingPropertiesForKeys: nil
        )) ?? []).filter { $0.pathExtension.lowercased() == "m4a" }.count
    }

    private func publishFinishedRecording(at draftURL: URL) throws -> URL {
        let pendingURL = pendingDirectory.appendingPathComponent(draftURL.lastPathComponent)
        try fileManager.moveItem(at: draftURL, to: pendingURL)
        return pendingURL
    }

    private func finishRecording(with recorder: AVAudioRecorder, succeeded: Bool) {
        guard self.recorder === recorder else { return }
        self.recorder = nil
        isRecording = false
        isProcessing = false
        elapsedText = "00:00"
        startedAt = nil

        defer {
            try? AVAudioSession.sharedInstance().setActive(
                false,
                options: .notifyOthersOnDeactivation
            )
        }

        guard succeeded else {
            statusMessage = "錄音未完成，草稿已保留"
            return
        }

        do {
            _ = try publishFinishedRecording(at: recorder.url)
            statusMessage = "已保存，等待傳送"
            refreshPendingCount()
            enqueuePendingFiles()
        } catch {
            statusMessage = "保存錄音失敗：\(error.localizedDescription)"
        }
    }
}

extension WatchRecordingManager: AVAudioRecorderDelegate {
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.finishRecording(with: recorder, succeeded: flag)
        }
    }
}

extension WatchRecordingManager: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            if activationState == .activated {
                self.enqueuePendingFiles()
            } else if let error {
                self.statusMessage = "同步服務啟用失敗：\(error.localizedDescription)"
            }
        }
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif

    func session(
        _ session: WCSession,
        fileTransfer: WCSessionFileTransfer,
        didFinishWithError error: Error?
    ) {
        DispatchQueue.main.async {
            if let error {
                self.statusMessage = "同步失敗，稍後重試：\(error.localizedDescription)"
            } else {
                self.awaitingReceiptFilenames.insert(fileTransfer.file.fileURL.lastPathComponent)
                self.statusMessage = "已傳送到 iPhone，等待確認"
            }
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let filename = (userInfo["receivedFilename"] ?? userInfo["uploadedFilename"]) as? String else {
            return
        }
        DispatchQueue.main.async {
            let safeFilename = URL(fileURLWithPath: filename).lastPathComponent
            let localFile = self.pendingDirectory.appendingPathComponent(safeFilename)
            try? self.fileManager.removeItem(at: localFile)
            self.awaitingReceiptFilenames.remove(safeFilename)
            self.refreshPendingCount()
            self.statusMessage = userInfo["uploadedFilename"] != nil
                ? "iPhone 已完成上傳"
                : "已同步到 iPhone"
            self.enqueuePendingFiles()
        }
    }
}
