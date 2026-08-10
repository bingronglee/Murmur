import SwiftUI

@main
struct VoiceNotesWatchApp: App {
    @StateObject private var recordingManager = WatchRecordingManager.shared

    var body: some Scene {
        WindowGroup {
            WatchContentView()
                .environmentObject(recordingManager)
        }
    }
}
