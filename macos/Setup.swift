// The setup window: six steps from a bare Mac to a live test jam, leaving
// ~/.config/nimbrung/jam.env behind for scripts/jam.sh. Every button runs the
// real command; when one fails, its last output line shows under the row and
// the button turns into "Try again".

import AppKit
import SwiftUI

// MARK: - jam.env, the file jam.sh sources

enum JamEnv {
    static let path = NSHomeDirectory() + "/.config/nimbrung/jam.env"

    /// KEY=value lines read the way bash's `.` reads the ones we write:
    /// "double quotes" with \" \\ \$ \` escapes, 'single quotes', or a bare word.
    static func parse(_ text: String) -> [String: String] {
        var values: [String: String] = [:]
        for raw in text.split(whereSeparator: \.isNewline) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("export ") { line.removeFirst("export ".count) }
            guard !line.hasPrefix("#"), let eq = line.firstIndex(of: "=") else { continue }
            values[String(line[..<eq])] = unquote(line[line.index(after: eq)...])
        }
        return values
    }

    private static func unquote(_ s: Substring) -> String {
        guard let quote = s.first, quote == "\"" || quote == "'" else {
            return String(s.prefix { !$0.isWhitespace })
        }
        var out = ""
        var escaped = false
        for c in s.dropFirst() {
            if escaped {
                if !"\"\\$`".contains(c) { out.append("\\") } // bash keeps other backslashes
                out.append(c)
                escaped = false
            } else if c == "\\" && quote == "\"" {
                escaped = true
            } else if c == quote {
                break
            } else {
                out.append(c)
            }
        }
        return out
    }

    /// Double quotes for bash: only \ " $ and ` are special inside them.
    static func quote(_ s: String) -> String {
        var out = "\""
        for c in s {
            if "\"\\$`".contains(c) { out.append("\\") }
            out.append(c)
        }
        return out + "\""
    }

    /// Plain values stay bare, as the README writes them; anything else is quoted.
    private static func bare(_ s: String) -> String {
        !s.isEmpty && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_./:".contains($0)) } ? s : quote(s)
    }

    /// The whole file. An empty tunnel means Wi-Fi only: no TUNNEL, no PUBLIC_URL.
    static func render(name: String, code: String, hostKey: String, tunnel: String, publicURL: String) -> String {
        let oneLine = name.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        var lines = [
            "# Settings for scripts/jam.sh (the Nimbrung launcher). Keep this file private.",
            "NAME=" + quote(oneLine.isEmpty ? "the jam" : oneLine),
            "CODE=" + bare(code),
            "HOST_KEY=" + bare(hostKey),
        ]
        if !tunnel.isEmpty { lines += ["TUNNEL=" + bare(tunnel), "PUBLIC_URL=" + bare(publicURL)] }
        return lines.joined(separator: "\n") + "\n"
    }

    /// What the join code field keeps of what was typed: A-Z and 0-9, uppercased, at most 8.
    static func cleanCode(_ s: String) -> String {
        String(s.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(8))
    }

    static func isValidCode(_ s: String) -> Bool { s.count >= 4 && cleanCode(s) == s }

    static func randomCode() -> String {
        String((0..<4).map { _ in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".randomElement()! })
    }

    static func randomHostKey() -> String {
        (0..<12).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
    }

    /// Private: it holds the host key. Written 0600 from the first byte, to a
    /// file beside it that is then renamed over it, so no one else can read it
    /// even for a moment and a crash can't leave half a file.
    static func save(_ text: String) throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let temp = path + ".new"
        unlink(temp) // a leftover from a crash, with whatever mode it had
        let fd = Darwin.open(temp, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do {
            try file.write(contentsOf: Data(text.utf8))
            try file.close()
        } catch {
            unlink(temp)
            throw error
        }
        guard rename(temp, path) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }
}

// MARK: - Running commands

/// A GUI app starts with a bare PATH; brew, ngrok and cloudflared live in Homebrew's.
func withBrewPath() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
    return env
}

struct RunResult {
    var status: Int32
    var output: String
    var last: String
    var ok: Bool { status == 0 }
}

/// Runs a command to the end on its own thread, killing it after `timeout`
/// seconds so no row spins forever. `progress` gets each newest output line.
func runCommand(_ args: [String], timeout: TimeInterval,
                progress: @escaping @Sendable (String) -> Void = { _ in }) async -> RunResult {
    await withCheckedContinuation { done in
        Thread.detachNewThread {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = args
            p.environment = withBrewPath()
            p.standardInput = FileHandle.nullDevice
            let pipe = Pipe()
            p.standardOutput = pipe
            p.standardError = pipe
            do { try p.run() } catch {
                done.resume(returning: RunResult(status: -1, output: "", last: error.localizedDescription))
                return
            }
            let deadline = DispatchWorkItem { if p.isRunning { p.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
            var output = ""
            var last = ""
            while case let data = pipe.fileHandleForReading.availableData, !data.isEmpty {
                let text = String(decoding: data, as: UTF8.self)
                output += text
                if let line = lastLine(text) { last = line; progress(line) }
            }
            p.waitUntilExit()
            deadline.cancel()
            var status = p.terminationStatus
            if p.terminationReason == .uncaughtSignal {
                status = -1
                last = "Gave up after \(Int(timeout)) seconds. " + last
            } else if status == 127 { // env: no such command
                last = args[0] == "brew" ? "Homebrew isn’t installed. Get it from brew.sh, then try again."
                    : "Couldn’t find \(args[0])."
            }
            done.resume(returning: RunResult(status: status, output: output, last: last))
        }
    }
}

/// brew and curl redraw progress with \r, so split on that too.
func lastLine(_ text: String) -> String? {
    text.split(whereSeparator: { $0 == "\n" || $0 == "\r" })
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .last { !$0.isEmpty }
}

// MARK: - The steps

enum Share: String, CaseIterable { case wifi, ngrok, cloudflare }

@MainActor @Observable
final class Setup {
    static let titles = ["Welcome", "YouTube Music", "Player control", "Sharing", "Your jam", "Test run"]
    static let ytmBundle = "com.github.th-ch.youtube-music" // pear-desktop keeps th-ch's id
    static let ytmConfig = NSHomeDirectory() + "/Library/Application Support/YouTube Music/config.json"
    static let ngrokConfig = NSHomeDirectory() + "/Library/Application Support/ngrok/ngrok.yml"
    static let cloudflareCert = NSHomeDirectory() + "/.cloudflared/cert.pem"

    let jam: Jam
    var step = 0
    var reached = 0
    var finished = false
    /// The row whose command is running; one at a time, like the prototype.
    var busy: String?
    var progress = ""
    var errors: [String: String] = [:]

    var ytmInstalled = false
    var signedIn = false
    var apiOn = false
    var connected = false

    var share = Share.ngrok
    var ngrokInstalled = false
    var ngrokTokenSaved = false
    var ngrokToken = ""
    var ngrokLink = ""
    var cfInstalled = false
    var cfSignedIn = false
    var cfHost = "jam.example.com"
    /// The host the tunnel was made for; editing the host makes it again.
    var cfMadeFor = ""
    var tunnelName = "nimbrung"

    var name = "my living room"
    var code = JamEnv.randomCode()
    var hostKey = JamEnv.randomHostKey()

    var startedTest = false
    /// The file the test jam went live with; a later edit needs another test.
    var testedFile: String?

    /// Prefills from an existing jam.env and keeps its HOST_KEY and CODE, so
    /// finishing without changes writes the same settings back.
    init(jam: Jam) {
        self.jam = jam
        guard let text = try? String(contentsOfFile: JamEnv.path, encoding: .utf8) else { return }
        let v = JamEnv.parse(text)
        if let n = v["NAME"], !n.isEmpty { name = n }
        if let c = v["CODE"], !c.isEmpty { code = JamEnv.cleanCode(c) }
        if let k = v["HOST_KEY"], !k.isEmpty { hostKey = k }
        let url = (v["PUBLIC_URL"] ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        switch v["TUNNEL"] ?? "" {
        case "" where url.isEmpty: share = .wifi
        case "ngrok": share = .ngrok; ngrokLink = url
        case let tunnel:
            share = .cloudflare
            tunnelName = tunnel.isEmpty ? "nimbrung" : tunnel
            cfHost = Setup.host(url)
            cfMadeFor = cfHost
        }
    }

    var publicURL: String {
        switch share {
        case .wifi: ""
        case .ngrok: ngrokLink
        case .cloudflare: "https://" + Setup.host(cfHost)
        }
    }

    var envFile: String {
        JamEnv.render(name: name, code: code, hostKey: hostKey,
                      tunnel: share == .wifi ? "" : share == .ngrok ? "ngrok" : tunnelName, publicURL: publicURL)
    }

    func isDone(_ i: Int) -> Bool {
        switch i {
        case 0: true
        case 1: ytmInstalled && signedIn
        case 2: apiOn && connected
        case 3:
            switch share {
            case .wifi: true
            case .ngrok: ngrokInstalled && ngrokTokenSaved && !ngrokLink.isEmpty
            case .cloudflare: cfInstalled && cfSignedIn && !cfMadeFor.isEmpty && cfMadeFor == Setup.host(cfHost)
            }
        case 4: !name.trimmingCharacters(in: .whitespaces).isEmpty && JamEnv.isValidCode(code)
        default: testedFile == envFile
        }
    }

    func next() {
        if step == Setup.titles.count - 1 { finished = true; return }
        step += 1
        reached = max(reached, step)
    }

    /// Looks again at what's installed: the host may fix things in Terminal meanwhile.
    func detect() async {
        ytmInstalled = Setup.ytmApp() != nil
        ngrokInstalled = Setup.tool("ngrok")
        ngrokTokenSaved = (try? String(contentsOfFile: Setup.ngrokConfig, encoding: .utf8))?.contains("authtoken:") ?? false
        cfInstalled = Setup.tool("cloudflared")
        cfSignedIn = FileManager.default.fileExists(atPath: Setup.cloudflareCert)
        if busy == nil { apiOn = Setup.pluginConfigured() ? await Jam.answers("http://127.0.0.1:26538/") : false }
    }

    // MARK: Actions

    /// Runs one row's work: marks it busy, then shows what `work` returns
    /// (nil = it worked) under the row.
    private func act(_ key: String, _ work: @escaping () async -> String?) {
        guard busy == nil else { return }
        busy = key
        errors[key] = nil
        progress = ""
        Task {
            let failure = await work()
            busy = nil
            errors[key] = failure
            await detect()
        }
    }

    private func run(_ args: [String], timeout: TimeInterval) async -> RunResult {
        await runCommand(args, timeout: timeout) { line in Task { @MainActor in self.progress = line } }
    }

    func installYTM() {
        act("ytm-install") {
            // The cask clears the download quarantine itself (its postflight runs xattr -cr).
            let r = await self.run(["brew", "install", "--cask", "pear-devs/pear/pear-desktop"], timeout: 900)
            return Setup.ytmApp() != nil ? nil : r.last.isEmpty ? "The install stopped (exit \(r.status))." : r.last
        }
    }

    func openYTM() {
        guard let app = Setup.ytmApp() else { return }
        NSWorkspace.shared.openApplication(at: app, configuration: .init())
    }

    /// The app only reads the plugin setting at start, and writes its config
    /// back when it quits, so: quit it, edit, open it again.
    func turnOnAPI() {
        act("api-on") {
            if !Setup.pluginConfigured() {
                if let running = Setup.runningYTM() {
                    running.terminate()
                    for _ in 0..<30 where !running.isTerminated { try? await Task.sleep(for: .milliseconds(500)) }
                    if !running.isTerminated { return "YouTube Music didn’t quit. Quit it yourself, then try again." }
                }
                if let failure = Setup.writePluginConfig() { return failure }
            }
            self.openYTM()
            for _ in 0..<30 {
                if await Jam.answers("http://127.0.0.1:26538/") { return nil }
                try? await Task.sleep(for: .seconds(1))
            }
            return "YouTube Music isn’t answering. In its menu bar: Plugins → API Server [Beta] → Enabled, then try again."
        }
    }

    /// nimbrung's own handshake and token cache: silent when the cached token still works.
    func connect() {
        act("api-connect") {
            let bin = self.jam.repo + "/nimbrung"
            guard FileManager.default.isExecutableFile(atPath: bin) else {
                return "No ./nimbrung yet. Run make build in \(self.jam.repo) first."
            }
            Setup.runningYTM()?.activate() // the Allow dialog is in there
            let r = await self.run([bin, "-authorize"], timeout: 180)
            if r.ok { self.connected = true; return nil }
            if r.status == 2 { return "This ./nimbrung is older than the app. Run make build in \(self.jam.repo), then try again." }
            return r.last
        }
    }

    func install(_ tool: String, key: String) {
        act(key) {
            let r = await self.run(["brew", "install", tool], timeout: 600)
            return r.ok ? nil : r.last
        }
    }

    func saveNgrokToken() {
        let token = ngrokToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { errors["ngrok-token"] = "Paste the authtoken from your ngrok dashboard first."; return }
        act("ngrok-token") {
            let r = await self.run(["ngrok", "config", "add-authtoken", token], timeout: 30)
            if r.ok { self.ngrokToken = "" }
            return r.ok ? nil : r.last
        }
    }

    /// Starts ngrok for a moment and reads its link from the agent's local API.
    /// A free account's link is its static dev domain, so it stays the same.
    func findNgrokLink() {
        act("ngrok-link") {
            if let link = await Setup.ngrokLink() { self.ngrokLink = link; return nil } // already running
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = ["ngrok", "http", "8080", "--log", "stdout"]
            p.environment = withBrewPath()
            let log = Pipe()
            p.standardOutput = log
            p.standardError = log
            p.standardInput = FileHandle.nullDevice
            do { try p.run() } catch { return error.localizedDescription }
            var link: String?
            for _ in 0..<30 where p.isRunning && link == nil {
                try? await Task.sleep(for: .milliseconds(500))
                link = await Setup.ngrokLink()
            }
            p.terminate()
            // ngrok has no children, so its exit closes the pipe.
            let out = await Task.detached { log.fileHandleForReading.readDataToEndOfFile() }.value
            if let link { self.ngrokLink = link; return nil }
            return lastLine(String(decoding: out, as: UTF8.self)) ?? "ngrok gave no link in 15 seconds."
        }
    }

    func cloudflareLogin() {
        act("cf-login") {
            let r = await self.run(["cloudflared", "tunnel", "login"], timeout: 600)
            return r.ok ? nil : r.last
        }
    }

    func makeTunnel() {
        let host = Setup.host(cfHost)
        guard host.range(of: "^[a-z0-9-]+(\\.[a-z0-9-]+)+$", options: .regularExpression) != nil else {
            errors["cf-create"] = "Use a hostname on your domain, like jam.example.com."
            return
        }
        act("cf-create") {
            let create = await self.run(["cloudflared", "tunnel", "create", self.tunnelName], timeout: 60)
            if !create.ok && !create.output.contains("already exists") { return create.last }
            let route = await self.run(["cloudflared", "tunnel", "route", "dns", self.tunnelName, host], timeout: 60)
            if !route.ok { return route.last }
            self.cfMadeFor = host
            return nil
        }
    }

    /// Saves jam.env (jam.sh reads it) and starts a real jam with it.
    func startTest() {
        do { try JamEnv.save(envFile) } catch {
            errors["test"] = "Couldn’t save jam.env: \(error.localizedDescription)"
            return
        }
        errors["test"] = nil
        startedTest = true
        jam.start(local: share == .wifi)
    }

    func jamWentLive() {
        if startedTest { testedFile = envFile }
    }

    // MARK: Looking around

    static func ytmApp() -> URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: ytmBundle)
            ?? ["/Applications/YouTube Music.app", NSHomeDirectory() + "/Applications/YouTube Music.app"]
            .first { FileManager.default.fileExists(atPath: $0) }.map { URL(fileURLWithPath: $0) }
    }

    static func runningYTM() -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: ytmBundle).first
    }

    static func tool(_ name: String) -> Bool {
        ["/opt/homebrew/bin/", "/usr/local/bin/"].contains { FileManager.default.isExecutableFile(atPath: $0 + name) }
    }

    /// "https://Jam.Example.com/" → "jam.example.com"
    static func host(_ s: String) -> String {
        var h = s.trimmingCharacters(in: .whitespaces).lowercased()
        for prefix in ["https://", "http://"] where h.hasPrefix(prefix) { h.removeFirst(prefix.count) }
        return h.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private static func apiServer(_ config: [String: Any]) -> [String: Any] {
        (config["plugins"] as? [String: Any])?["api-server"] as? [String: Any] ?? [:]
    }

    static func pluginConfigured() -> Bool {
        guard let data = FileManager.default.contents(atPath: ytmConfig),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        let server = apiServer(config)
        return server["enabled"] as? Bool == true && server["port"] as? Int == 26538
            && server["hostname"] as? String == "127.0.0.1"
    }

    /// Sets plugins.api-server to enabled on 127.0.0.1:26538, keeping the rest.
    /// Returns why it couldn't, or nil.
    static func writePluginConfig() -> String? {
        var config: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: ytmConfig) {
            guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return "Couldn’t read YouTube Music’s config.json, so left it alone."
            }
            config = parsed
        }
        var server = apiServer(config)
        server["enabled"] = true
        server["port"] = 26538
        server["hostname"] = "127.0.0.1"
        var plugins = config["plugins"] as? [String: Any] ?? [:]
        plugins["api-server"] = server
        config["plugins"] = plugins
        do {
            let data = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .withoutEscapingSlashes])
            try FileManager.default.createDirectory(atPath: (ytmConfig as NSString).deletingLastPathComponent,
                                                    withIntermediateDirectories: true)
            try data.write(to: URL(fileURLWithPath: ytmConfig), options: .atomic)
            return nil
        } catch {
            return "Couldn’t save YouTube Music’s config.json: \(error.localizedDescription)"
        }
    }

    /// The https link of an ngrok agent already running on this Mac, if any.
    static func ngrokLink() async -> String? {
        struct Tunnels: Decodable { struct T: Decodable { let public_url: String }; let tunnels: [T] }
        guard let (data, _) = try? await URLSession.shared.data(
            for: URLRequest(url: URL(string: "http://127.0.0.1:4040/api/tunnels")!, timeoutInterval: 2)),
            let found = try? JSONDecoder().decode(Tunnels.self, from: data)
        else { return nil }
        return found.tunnels.map(\.public_url).first { $0.hasPrefix("https://") }
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
    }
}

// MARK: - Window

@MainActor
enum SetupWindow {
    private static var window: NSWindow?

    /// A plain NSWindow: a menu-bar app's SwiftUI Window scene can't open
    /// itself at launch on macOS 14.
    static func show(jam: Jam) {
        if let window, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let w = window ?? NSWindow(contentRect: .zero, styleMask: [.titled, .closable, .miniaturizable],
                                   backing: .buffered, defer: false)
        w.title = "Set up Nimbrung"
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: SetupView(setup: Setup(jam: jam)))
        w.center()
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    static func close() { window?.close() }
}

// MARK: - Views

enum RowState { case todo, now, busy, done }

struct RowIcon: View {
    let state: RowState
    var body: some View {
        Group {
            switch state {
            case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case .busy: ProgressView().controlSize(.small)
            case .now: Image(systemName: "circle.inset.filled").foregroundStyle(Color.nimbrungRed)
            case .todo: Image(systemName: "circle").foregroundStyle(.tertiary)
            }
        }
        .frame(width: 18, height: 18)
    }
}

/// One line of a step's checklist: icon, title, detail under it, buttons on the right.
struct CheckRow<Detail: View, Actions: View>: View {
    let state: RowState
    let title: String
    @ViewBuilder var detail: () -> Detail
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RowIcon(state: state)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.callout.weight(.semibold))
                detail().font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            actions()
        }
        .padding(14)
    }
}

struct SetupView: View {
    @Bindable var setup: Setup

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if setup.finished { allSet } else { pane }
                    }
                    .padding(26)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider()
                footer
            }
        }
        .frame(width: 780, height: 560)
        .task(id: setup.step) { await setup.detect() }
        .onChange(of: setup.jam.isLive) { _, live in if live { setup.jamWentLive() } }
    }

    // MARK: Frame

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 28, height: 28)
                Text("Nimbrung").font(.headline)
            }
            .padding([.horizontal, .bottom], 8)
            ForEach(Setup.titles.indices, id: \.self) { i in
                let current = i == setup.step && !setup.finished
                let done = setup.finished || (!current && i <= setup.reached && setup.isDone(i))
                Button { setup.step = i } label: {
                    HStack(spacing: 10) {
                        RowIcon(state: done ? .done : current ? .now : .todo)
                        Text(Setup.titles[i]).fontWeight(current ? .semibold : .regular)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(current ? AnyShapeStyle(.background) : AnyShapeStyle(.clear),
                                in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(current || done ? .primary : .secondary)
                .disabled(i > setup.reached || setup.finished)
            }
            Spacer()
        }
        .padding(12)
        .frame(width: 210)
        .background(.background.secondary)
    }

    private var footer: some View {
        HStack {
            if setup.finished {
                Text("Setup done").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Close") { SetupWindow.close() }
                    .buttonStyle(.borderedProminent).tint(.nimbrungRed).keyboardShortcut(.defaultAction)
            } else {
                Button("Back") { setup.step -= 1 }.disabled(setup.step == 0)
                Spacer()
                Text("Step \(setup.step + 1) of \(Setup.titles.count)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(setup.step == 0 ? "Get started" : setup.step == Setup.titles.count - 1 ? "Finish" : "Continue") {
                    setup.next()
                }
                .buttonStyle(.borderedProminent).tint(.nimbrungRed).keyboardShortcut(.defaultAction)
                .disabled(!setup.isDone(setup.step) || setup.busy != nil)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    @ViewBuilder private var pane: some View {
        switch setup.step {
        case 0: welcome
        case 1: youTubeMusic
        case 2: playerControl
        case 3: sharing
        case 4: yourJam
        default: testRun
        }
    }

    // MARK: Bits

    private func heading(_ s: String) -> some View { Text(s).font(.title2.weight(.semibold)) }

    private func checks<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.separator))
    }

    private func runs(_ command: String) -> some View {
        Text("Runs \(Text(command).font(.caption.monospaced()))").font(.caption).foregroundStyle(.secondary)
            .textSelection(.enabled)
    }

    private func note(_ text: LocalizedStringKey) -> some View {
        Text(text).font(.caption).foregroundStyle(.secondary)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(.quinary, in: RoundedRectangle(cornerRadius: 9))
    }

    /// While a row runs: the command's newest line. After it failed: its last line.
    @ViewBuilder private func status(_ key: String) -> some View {
        if setup.busy == key, !setup.progress.isEmpty {
            Text(setup.progress).font(.caption.monospaced()).foregroundStyle(.tertiary).textSelection(.enabled)
                .lineLimit(1).truncationMode(.middle)
        } else if let error = setup.errors[key] {
            Label(error, systemImage: "exclamationmark.triangle.fill").font(.caption)
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
    }

    @ViewBuilder
    private func action(_ key: String, _ title: String, _ busyTitle: String, primary: Bool = true,
                        disabled: Bool = false, _ run: @escaping () -> Void) -> some View {
        let label = setup.busy == key ? busyTitle : setup.errors[key] != nil ? "Try again" : title
        if primary {
            Button(label, action: run).buttonStyle(.borderedProminent).tint(.nimbrungRed)
                .disabled(setup.busy != nil || disabled)
        } else {
            Button(label, action: run).buttonStyle(.bordered).disabled(setup.busy != nil || disabled)
        }
    }

    private func state(done: Bool, key: String, ready: Bool = true) -> RowState {
        done ? .done : setup.busy == key ? .busy : ready ? .now : .todo
    }

    // MARK: Steps

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 12) {
            heading("Host a jam from this Mac")
            Text("This Mac plays the music. Guests scan a QR code and add songs from their phones. Takes about 5 minutes.")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var youTubeMusic: some View {
        heading("YouTube Music")
        checks {
            if setup.ytmInstalled {
                CheckRow(state: .done, title: "Found YouTube Music") {} actions: {}
            } else {
                CheckRow(state: state(done: false, key: "ytm-install"), title: "Install YouTube Music") {
                    runs("brew install --cask pear-devs/pear/pear-desktop")
                    status("ytm-install")
                } actions: {
                    action("ytm-install", "Install", "Installing…") { setup.installYTM() }
                }
            }
            Divider()
            CheckRow(state: setup.signedIn ? .done : setup.ytmInstalled ? .now : .todo, title: "Sign in") {
                Toggle("I’m signed in", isOn: $setup.signedIn).toggleStyle(.checkbox)
                    .foregroundStyle(.primary).disabled(!setup.ytmInstalled)
            } actions: {
                Button("Open YouTube Music") { setup.openYTM() }.buttonStyle(.bordered).disabled(!setup.ytmInstalled)
            }
        }
    }

    @ViewBuilder private var playerControl: some View {
        heading("Player control")
        checks {
            if setup.apiOn {
                CheckRow(state: .done, title: "API Server is on") {} actions: {}
            } else {
                CheckRow(state: state(done: false, key: "api-on"), title: "Turn on its API Server") {
                    runs("set plugins.api-server: enabled, port 26538, host 127.0.0.1 in the app’s config.json, then restart the app")
                    status("api-on")
                } actions: {
                    action("api-on", "Turn it on", "Turning on…") { setup.turnOnAPI() }
                }
            }
            Divider()
            if setup.connected {
                CheckRow(state: .done, title: "Nimbrung can control the player") {} actions: {}
            } else if setup.busy == "api-connect" {
                CheckRow(state: .busy, title: "Click Allow in YouTube Music") {
                    Text("Switch to the app and click **Allow**.").foregroundStyle(.primary)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.nimbrungRed.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                } actions: {}
            } else {
                CheckRow(state: state(done: false, key: "api-connect", ready: setup.apiOn), title: "Let Nimbrung in") {
                    runs("nimbrung asks 127.0.0.1:26538 for a key")
                    status("api-connect")
                } actions: {
                    action("api-connect", "Connect", "Connecting…", disabled: !setup.apiOn) { setup.connect() }
                }
            }
        }
    }

    @ViewBuilder private var sharing: some View {
        heading("How guests reach you")
        HStack(spacing: 10) {
            choice(.wifi, "Wi-Fi", "Same network", icon: "wifi")
            choice(.ngrok, "ngrok", "Free link", icon: "link")
            choice(.cloudflare, "Domain", "Cloudflare", icon: "globe")
        }
        checks {
            switch setup.share {
            case .wifi:
                CheckRow(state: .done, title: "Nothing to set up") { Text("Guests join on this Wi-Fi.") } actions: {}
            case .ngrok: ngrokRows
            case .cloudflare: cloudflareRows
            }
        }
    }

    private func choice(_ value: Share, _ title: String, _ sub: String, icon: String) -> some View {
        let on = setup.share == value
        return Button { setup.share = value } label: {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.title2).foregroundStyle(on ? Color.nimbrungRed : .secondary)
                Text(title).font(.callout.weight(.semibold))
                Text(sub).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .overlay(RoundedRectangle(cornerRadius: 14)
                .strokeBorder(on ? Color.nimbrungRed : Color(nsColor: .separatorColor), lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(setup.busy != nil)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private var ngrokRows: some View {
        if setup.ngrokInstalled {
            CheckRow(state: .done, title: "ngrok is installed") {} actions: {}
        } else {
            CheckRow(state: state(done: false, key: "ngrok-install"), title: "Install ngrok") {
                runs("brew install ngrok")
                status("ngrok-install")
            } actions: {
                action("ngrok-install", "Install", "Installing…") { setup.install("ngrok", key: "ngrok-install") }
            }
        }
        Divider()
        CheckRow(state: state(done: setup.ngrokTokenSaved, key: "ngrok-token", ready: setup.ngrokInstalled),
                 title: "Connect your free ngrok account") {
            if setup.ngrokTokenSaved {
                Text("Token saved.")
            } else {
                Text("[Sign up free](https://dashboard.ngrok.com/signup), then paste your authtoken.")
                HStack {
                    SecureField("Authtoken", text: $setup.ngrokToken).textFieldStyle(.roundedBorder)
                        .disabled(!setup.ngrokInstalled)
                    action("ngrok-token", "Save", "Saving…", primary: false, disabled: !setup.ngrokInstalled) {
                        setup.saveNgrokToken()
                    }
                }
                status("ngrok-token")
                runs("ngrok config add-authtoken <token>")
            }
        } actions: {}
        Divider()
        CheckRow(state: state(done: !setup.ngrokLink.isEmpty, key: "ngrok-link", ready: setup.ngrokTokenSaved),
                 title: "Get your link") {
            if setup.ngrokLink.isEmpty {
                runs("ngrok http 8080 for a moment, read the link from its local API on :4040")
                status("ngrok-link")
            } else {
                Text(setup.ngrokLink).font(.callout.monospaced()).foregroundStyle(.primary).textSelection(.enabled)
            }
        } actions: {
            if setup.ngrokLink.isEmpty {
                action("ngrok-link", "Find my link", "Finding…", disabled: !setup.ngrokTokenSaved) { setup.findNgrokLink() }
            }
        }
        Divider()
        note("Guests tap **Visit Site** on an ngrok page once a week. Free plan: 1 GB a month.").padding(12)
    }

    @ViewBuilder private var cloudflareRows: some View {
        if setup.cfInstalled {
            CheckRow(state: .done, title: "cloudflared is installed") {} actions: {}
        } else {
            CheckRow(state: state(done: false, key: "cf-install"), title: "Install cloudflared") {
                runs("brew install cloudflared")
                status("cf-install")
            } actions: {
                action("cf-install", "Install", "Installing…") { setup.install("cloudflared", key: "cf-install") }
            }
        }
        Divider()
        CheckRow(state: state(done: setup.cfSignedIn, key: "cf-login", ready: setup.cfInstalled), title: "Sign in to Cloudflare") {
            if !setup.cfSignedIn {
                Text("Pick your domain in the browser.")
                runs("cloudflared tunnel login")
                status("cf-login")
            }
        } actions: {
            if !setup.cfSignedIn {
                action("cf-login", "Sign in", "Waiting for browser…", disabled: !setup.cfInstalled) { setup.cloudflareLogin() }
            }
        }
        Divider()
        let made = !setup.cfMadeFor.isEmpty && setup.cfMadeFor == Setup.host(setup.cfHost)
        CheckRow(state: state(done: made, key: "cf-create", ready: setup.cfSignedIn), title: "Make the tunnel") {
            HStack {
                TextField("jam.example.com", text: $setup.cfHost).textFieldStyle(.roundedBorder)
                    .disabled(!setup.cfSignedIn || setup.busy != nil)
                if !made {
                    action("cf-create", "Make tunnel", "Making…", disabled: !setup.cfSignedIn) { setup.makeTunnel() }
                }
            }
            if made {
                Text("https://" + setup.cfMadeFor).font(.callout.monospaced()).foregroundStyle(.primary)
            } else {
                status("cf-create")
                runs("cloudflared tunnel create \(setup.tunnelName) && cloudflared tunnel route dns \(setup.tunnelName) \(Setup.host(setup.cfHost))")
            }
        } actions: {}
    }

    @ViewBuilder private var yourJam: some View {
        heading("Your jam")
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Room name").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Room name", text: $setup.name).textFieldStyle(.roundedBorder).labelsHidden()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Join code").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                TextField("Join code", text: $setup.code).textFieldStyle(.roundedBorder).labelsHidden()
                    .font(.body.monospaced())
                    .onChange(of: setup.code) { _, typed in
                        let clean = JamEnv.cleanCode(typed)
                        if clean != typed { setup.code = clean }
                    }
                Text("4 to 8 letters or numbers.").font(.caption).foregroundStyle(.secondary)
            }
        }
        DisclosureGroup {
            Text(setup.envFile).font(.caption.monospaced()).textSelection(.enabled)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(.quinary, in: RoundedRectangle(cornerRadius: 10))
        } label: {
            Text("What gets saved to \(Text("~/.config/nimbrung/jam.env").font(.caption.monospaced()))")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    /// The jam's own steps, named the way the prototype names them.
    private var testRows: [(title: String, state: RowState)] {
        let jam = setup.jam
        func done(_ id: String) -> Bool { jam.steps.first { $0.id == id }?.state == .done }
        var rows = [("Open YouTube Music", done("ytm") && done("api"))]
        if !jam.local { rows.append((setup.share == .ngrok ? "Start the ngrok tunnel" : "Start the Cloudflare tunnel", done("tunnel"))) }
        rows.append(("Start Nimbrung", jam.serverUp))
        rows.append((jam.local ? "Find this Mac on Wi-Fi" : "Open the link from outside",
                     jam.isLive && !jam.inviteURL.isEmpty))
        let ours = setup.startedTest && jam.isRunning
        return rows.indices.map { i in
            let (title, isDone) = rows[i]
            guard ours else { return (title, .todo) }
            return (title, isDone ? .done : (i == 0 || rows[i - 1].1) ? .busy : .todo)
        }
    }

    @ViewBuilder private var testRun: some View {
        let jam = setup.jam
        heading("Test run")
        checks {
            ForEach(Array(testRows.enumerated()), id: \.offset) { i, row in
                if i > 0 { Divider() }
                CheckRow(state: row.state, title: row.title) {} actions: {}
            }
        }
        if setup.startedTest && jam.isLive {
            HStack(spacing: 18) {
                if let qr = qrImage(jam.inviteURL) {
                    Image(nsImage: qr).interpolation(.none).resizable()
                        .frame(width: 100, height: 100).padding(6)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your jam is live").font(.headline)
                    Text(jam.inviteURL).font(.callout.monospaced()).textSelection(.enabled)
                }
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        } else if jam.isRunning && !setup.startedTest {
            note("A jam is already running. Stop it from the menu bar, then start the test jam.")
        } else if jam.phase == .starting {
            HStack {
                Button("Starting…") {}.buttonStyle(.borderedProminent).tint(.nimbrungRed).disabled(true)
                Button("Cancel") { jam.cancel() }.buttonStyle(.bordered)
            }
        } else {
            if case .failed(let why) = jam.phase, setup.startedTest {
                Label(why, systemImage: "exclamationmark.triangle.fill").font(.caption)
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            status("test")
            if setup.isDone(5) {
                Label("The test jam went live.", systemImage: "checkmark.circle.fill").font(.callout)
            }
            Button(jam.phase != .stopped && setup.startedTest ? "Try again" : "Start a test jam") { setup.startTest() }
                .buttonStyle(.borderedProminent).tint(.nimbrungRed)
        }
    }

    private var allSet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
            heading("All set")
            Text("Next time: click the jar in the menu bar, then **Start the jam**.").foregroundStyle(.secondary)
        }
    }
}
