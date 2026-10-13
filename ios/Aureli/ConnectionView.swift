import SwiftUI

struct ConnectionView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error: String?
    @State private var isConnecting = false
    @State private var connectionTask: Task<Void, Never>?
    var body: some View {
        NavigationStack {
            Form {
                Section("Aureli 后端地址") {
                    TextField("http://Mac的IP:18082", text: $address)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("Aureli 后端服务地址")
                    Text("iPhone 请填写 Mac 的局域网地址；模拟器可使用 http://127.0.0.1:18081。").font(.footnote)
                }
                Section {
                    Button {
                        isConnecting = true
                        error = nil
                        connectionTask = Task {
                            defer { isConnecting = false; connectionTask = nil }
                            do { try await store.connect(to: address); dismiss() }
                            catch is CancellationError { }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack {
                            Text(isConnecting ? "正在连接…" : "连接工作空间")
                            Spacer()
                            if isConnecting { ProgressView() }
                        }.frame(minHeight: 44)
                    }.disabled(isConnecting || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let error { Text(error).foregroundStyle(.red).accessibilityLabel("连接失败：\(error)") }
                }
                Section("连接方式") {
                    Text("Mac 上先运行桌面开发版，再运行 ios/scripts/dev-proxy.cjs。手机和 Mac 连接同一个 Wi-Fi，并允许本地网络访问。")
                    Text("此客户端不在手机上启动 Java、数据库或模型。Mac 关闭后，局域网服务也会停止。")
                    #if DEBUG
                    Text("开发构建支持 HTTP。正式构建要求 HTTPS 服务。")
                    #endif
                }.font(.footnote)
            }
            .navigationTitle("服务连接").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { connectionTask?.cancel(); dismiss() } } }
            .onAppear { address = store.serviceURL }
            .onDisappear { connectionTask?.cancel() }
            .interactiveDismissDisabled(isConnecting)
        }
    }
}
