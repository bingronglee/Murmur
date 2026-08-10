import SwiftUI

struct PhoneContentView: View {
    @EnvironmentObject private var transferManager: PhoneTransferManager
    @AppStorage("uploadEndpoint") private var uploadEndpoint = PhoneTransferManager.defaultUploadEndpoint
    @AppStorage("uploadToken") private var uploadToken = ""

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [Color(red: 0.04, green: 0.12, blue: 0.15), .black],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        statusCard
                        endpointCard

                        Button {
                            transferManager.retryPendingUploads()
                        } label: {
                            Label("立即重試", systemImage: "arrow.clockwise")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.40, green: 0.79, blue: 0.69))
                    }
                    .padding(20)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: "waveform")
                .font(.title2.weight(.bold))
                .foregroundStyle(Color(red: 0.55, green: 0.94, blue: 0.82))
                .frame(width: 52, height: 52)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))

            VStack(alignment: .leading, spacing: 2) {
                Text("語音記事")
                    .font(.title2.bold())
                Text("iPhone 中繼站")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 12)
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(transferManager.watchState, systemImage: "applewatch")
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(transferManager.watchState == "已啟用" ? .green : .orange)
                    .frame(width: 9, height: 9)
            }

            Divider().overlay(.white.opacity(0.12))

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("等待上傳")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(transferManager.pendingCount)")
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                }
                Spacer()
                Image(systemName: transferManager.pendingCount == 0 ? "checkmark.circle.fill" : "arrow.up.circle.fill")
                    .font(.system(size: 38))
                    .foregroundStyle(transferManager.pendingCount == 0 ? .green : .orange)
            }

            Text(transferManager.statusMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var endpointCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("上傳位置", systemImage: "externaldrive.connected.to.line.below")
                .font(.headline)
            TextField("伺服器網址", text: $uploadEndpoint)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .font(.footnote.monospaced())
                .padding(12)
                .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 12))
            Text("公開的 HTTPS 網址，例如 https://voice.example.com/api/upload。")
                .font(.caption)
                .foregroundStyle(.secondary)

            Label("上傳金鑰", systemImage: "key.fill")
                .font(.headline)
                .padding(.top, 4)
            SecureField("與伺服器 UPLOAD_TOKEN 相同", text: $uploadToken)
                .textInputAutocapitalization(.never)
                .font(.footnote.monospaced())
                .padding(12)
                .background(.black.opacity(0.28), in: RoundedRectangle(cornerRadius: 12))
            Text("需與伺服器 .env 的 UPLOAD_TOKEN 完全一致，否則上傳會被拒絕。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
