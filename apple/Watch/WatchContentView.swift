import SwiftUI

struct WatchContentView: View {
    @EnvironmentObject private var recordingManager: WatchRecordingManager

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [Color(red: 0.08, green: 0.24, blue: 0.28), .black],
                center: .top,
                startRadius: 10,
                endRadius: 190
            )
            .ignoresSafeArea()

            VStack(spacing: 9) {
                Text(recordingManager.isRecording ? recordingManager.elapsedText : "語音記事")
                    .font(recordingManager.isRecording ? .title2.monospacedDigit().bold() : .headline)

                Button {
                    recordingManager.toggleRecording()
                } label: {
                    ZStack {
                        Circle()
                            .fill(recordingManager.isRecording ? Color.red.opacity(0.22) : Color.green.opacity(0.18))
                            .frame(width: 92, height: 92)
                        Circle()
                            .fill(recordingManager.isRecording ? Color.red : Color(red: 0.40, green: 0.79, blue: 0.69))
                            .frame(width: 72, height: 72)
                            .shadow(color: (recordingManager.isRecording ? Color.red : Color.green).opacity(0.4), radius: 10)
                        if recordingManager.isProcessing {
                            ProgressView()
                                .controlSize(.large)
                                .tint(.white)
                        } else {
                            Image(systemName: recordingManager.isRecording ? "stop.fill" : "mic.fill")
                                .font(.title2.weight(.bold))
                                .foregroundStyle(.white)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(recordingManager.isProcessing)
                .sensoryFeedback(.start, trigger: recordingManager.isRecording)
                .sensoryFeedback(.impact(weight: .medium), trigger: recordingManager.isProcessing)

                Text(recordingManager.statusMessage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if recordingManager.pendingCount > 0 {
                    Label("待同步 \(recordingManager.pendingCount)", systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(.orange.opacity(0.14), in: Capsule())
                }
            }
            .padding(.horizontal, 8)
        }
    }
}
