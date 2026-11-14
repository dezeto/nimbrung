// Nimbrung's macOS launcher: a menu-bar panel that starts, watches and stops
// a jam. It runs scripts/jam.sh (the one place that knows how to start
// YouTube Music, the tunnel and the server) and only watches from outside,
// so the panel and the script can't disagree about how a jam starts.
//
// The setup window that makes jam.env lives in Setup.swift.
// Built by `make app` (runs the checkout named in Info.plist's NimbrungRepo)
// or `make dist` (carries nimbrung and jam.sh in Contents/Resources).

import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

// MARK: - Settings (~/.config/nimbrung/jam.env, the same file jam.sh reads)

struct JamSettings {
    var name = "the jam"
    var code = ""
    var publicURL = ""
    /// "ngrok", a Cloudflare tunnel name, or "" when guests join on Wi-Fi.
    var tunnel = ""
    /// False until the setup window (or the README) has made jam.env.
    var exists = false

    var inviteURL: String { publicURL.isEmpty || code.isEmpty ? "" : "\(publicURL)/join/\(code)" }
    /// No PUBLIC_URL: nothing to tunnel to, so jam.sh runs as --local.
    var wifiOnly: Bool { publicURL.isEmpty }

    static func load() -> JamSettings {
        guard let text = try? String(contentsOfFile: JamEnv.path, encoding: .utf8) else { return JamSettings() }
        let values = JamEnv.parse(text)
        var s = JamSettings()
        s.exists = true
        s.name = values["NAME"] ?? s.name
        s.code = values["CODE"] ?? ""
        s.publicURL = (values["PUBLIC_URL"] ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        s.tunnel = values["TUNNEL"] ?? ""
        return s
    }
}

// MARK: - The jam

enum StepState { case waiting, running, done }

struct Step: Identifiable {
    let id: String
    let title: String
    var state: StepState = .waiting
    var detail: String {
        switch (id, state) {
        case ("ytm", .done): "Open"
        case ("api", .done): "On"
        case ("tunnel", .done): "Connected"
        case ("live", .done): "Live"
        case (_, .running): id == "tunnel" ? "Connecting…" : "Starting…"
        default: "Waiting"
        }
    }
}

enum Phase: Equatable { case stopped, starting, live, failed(String) }

@MainActor @Observable
final class Jam {
    var phase: Phase = .stopped
    var steps: [Step] = Jam.freshSteps()
    var guestCount = 0
    var liveSince: Date?
    var settings = JamSettings.load()
    /// Wi-Fi only: no tunnel, guests join on the server's LAN link.
    var local = false
    var lanInviteURL = ""
    /// nimbrung answers on this Mac; the setup window's test run shows it.
    var serverUp = false

    private var process: Process?
    private var lastLine = ""
    private var watcher: Task<Void, Never>?
    let repo = Jam.home()

    /// Where ./nimbrung and scripts/jam.sh live: inside the app when `make dist`
    /// packed them into Contents/Resources, else the checkout `make app` named.
    static func home() -> String {
        let fm = FileManager.default
        if let res = Bundle.main.resourcePath,
           fm.isExecutableFile(atPath: res + "/nimbrung"), fm.fileExists(atPath: res + "/scripts/jam.sh") {
            return res
        }
        return Bundle.main.object(forInfoDictionaryKey: "NimbrungRepo") as? String ?? ""
    }

    static func freshSteps(local: Bool = false) -> [Step] {
        [Step(id: "ytm", title: "YouTube Music"), Step(id: "api", title: "API Server")]
            + (local ? [] : [Step(id: "tunnel", title: "Tunnel")])
            + [Step(id: "live", title: "Room goes live")]
    }

    /// Where guests and the host page are reached in the current mode.
    var baseURL: String { local ? "http://localhost:8080" : settings.publicURL }
    /// The Wi-Fi link is only known once the server answers; the public one is fixed.
    /// Stopped, it's the public link again, so it can go out before the party.
    var inviteURL: String { local && isRunning ? lanInviteURL : settings.inviteURL }

    var isLive: Bool { phase == .live }
    var isRunning: Bool { phase == .starting || phase == .live }
    var doneCount: Int { steps.filter { $0.state == .done }.count }

    func start(local: Bool = false) {
        settings = JamSettings.load()
        self.local = local || settings.wifiOnly
        lanInviteURL = ""
        serverUp = false
        steps = Jam.freshSteps(local: self.local)
        lastLine = ""
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [repo + "/scripts/jam.sh"] + (self.local ? ["--local"] : [])
        p.currentDirectoryURL = URL(fileURLWithPath: repo)
        p.environment = withBrewPath() // jam.sh needs Homebrew's cloudflared or ngrok
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        // The script's last words say why it stopped ("YouTube Music isn't answering…").
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            let line = text.split(separator: "\n").last.map(String.init) ?? ""
            if !line.isEmpty { Task { @MainActor in self.lastLine = line } }
        }
        p.terminationHandler = { proc in
            let status = proc.terminationStatus
            Task { @MainActor in self.ended(status: status) }
        }
        do {
            try p.run()
        } catch {
            phase = .failed("Couldn’t run scripts/jam.sh: \(error.localizedDescription)")
            return
        }
        process = p
        phase = .starting
        watch()
    }

    /// Stops the script's children first: bash waits for its foreground job
    /// before running its exit trap, so signalling bash alone would hang.
    func stop() {
        guard let p = process, p.isRunning else { return }
        let kill = Process()
        kill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        kill.arguments = ["-TERM", "-P", String(p.processIdentifier)]
        try? kill.run()
        kill.waitUntilExit()
        p.terminate()
    }

    private func ended(status: Int32) {
        watcher?.cancel()
        process = nil
        liveSince = nil
        guestCount = 0
        serverUp = false
        // Stopped on purpose (SIGTERM) or cleanly: back to stopped. Anything else failed.
        if phase == .stopped || status == 0 || status == 15 || status == 143 {
            phase = .stopped
        } else {
            phase = .failed(lastLine.isEmpty ? "The jam stopped (exit \(status))." : lastLine)
        }
        steps = Jam.freshSteps(local: local)
    }

    func cancel() {
        phase = .stopped
        stop()
    }

    // Watches from outside, once a second: the app, the plugin port, the
    // tunnel process, then the public link answering.
    private func watch() {
        watcher?.cancel()
        watcher = Task { [weak self] in
            while !Task.isCancelled {
                await self?.poll()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func poll() async {
        let ytm = Jam.running("YouTube Music")
        let api = await Jam.answers("http://127.0.0.1:26538/")
        let room = baseURL.isEmpty ? nil : await Jam.roomInfo("\(baseURL)/api/room")
        let tunnel = Jam.running(settings.tunnel == "ngrok" ? "ngrok" : "cloudflared")
        let done = local ? [ytm, api, room != nil] : [ytm, api, tunnel, room != nil]
        if local, let link = room?.joinUrl { lanInviteURL = link }
        serverUp = local ? room != nil : await Jam.roomInfo("http://localhost:8080/api/room") != nil
        var next = steps
        for i in next.indices {
            next[i].state = done[i] ? .done : (i == 0 || done[i - 1]) ? .running : .waiting
        }
        steps = next
        guestCount = room?.guests ?? 0
        if room != nil, phase == .starting {
            phase = .live
            liveSince = Date()
        }
    }

    private static func running(_ name: String) -> Bool {
        NSWorkspace.shared.runningApplications.contains { $0.localizedName == name }
            || pgrep(name)
    }

    private static func pgrep(_ name: String) -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        p.arguments = ["-xq", name]
        try? p.run()
        p.waitUntilExit()
        return p.terminationStatus == 0
    }

    static func answers(_ url: String) async -> Bool {
        guard let u = URL(string: url) else { return false }
        var req = URLRequest(url: u, timeoutInterval: 2)
        req.httpMethod = "HEAD"
        return (try? await URLSession.shared.data(for: req)) != nil
    }

    struct RoomInfo: Decodable { let guests: Int; let joinUrl: String? }

    private static func roomInfo(_ url: String) async -> RoomInfo? {
        guard let u = URL(string: url),
              let (data, resp) = try? await URLSession.shared.data(for: URLRequest(url: u, timeoutInterval: 3)),
              (resp as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return try? JSONDecoder().decode(RoomInfo.self, from: data)
    }
}

// MARK: - Panel

extension Color {
    /// #D62B30 in every state: white text on it is 4.9:1.
    static let nimbrungRed = Color(red: 0xD6 / 255, green: 0x2B / 255, blue: 0x30 / 255)
}

struct JamPanel: View {
    @Environment(Jam.self) private var jam
    @State private var confirmStop = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Divider()
            switch jam.phase {
            case .stopped where !jam.settings.exists:
                Button { SetupWindow.show(jam: jam) } label: {
                    Label("Set up Nimbrung", systemImage: "wand.and.stars").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large).tint(.nimbrungRed)
                Text("Takes about 5 minutes.").font(.caption).foregroundStyle(.secondary)
            case .stopped where jam.settings.wifiOnly:
                startButton(hint: "No tunnel. Guests must be on the same Wi-Fi as this Mac.", local: true)
            case .stopped:
                startButton(hint: "Opens YouTube Music, the tunnel and the room.")
                wifiButton
            case .failed(let why):
                Label(why, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                startButton(title: "Try again", hint: nil, local: jam.local)
            case .starting:
                ForEach(jam.steps) { StepRow(step: $0) }
                Button("Cancel") { jam.cancel() }.buttonStyle(.bordered)
            case .live:
                Label("\(jam.local ? "Live on Wi-Fi" : "Live") · \(jam.guestCount) \(jam.guestCount == 1 ? "guest" : "guests") in the jam",
                      systemImage: "dot.radiowaves.left.and.right")
                    .foregroundStyle(.primary)
            }
            Divider()
            invite
            Divider()
            menuButton("Open host page", enabled: jam.isLive) { openHost() }
            menuButton("Room view", key: "⌥R", enabled: jam.isLive) { open("/room") }
                .keyboardShortcut("r", modifiers: .option)
            if confirmStop {
                stopConfirm
            } else if jam.isRunning {
                menuButton("Stop the jam…") {
                    if jam.guestCount > 0 { confirmStop = true } else { jam.stop() }
                }
            }
            Divider()
            menuButton("Set up…") { SetupWindow.show(jam: jam) }
            menuButton("Quit Nimbrung", key: "⌘Q") { quit() } // stops the jam, no asking
            .keyboardShortcut("q")
        }
        .padding(14)
        .frame(width: 320)
    }

    /// Asked inline: a confirmationDialog inside a menu-bar panel shows but
    /// never receives its clicks.
    private var stopConfirm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Stop the jam?").font(.headline)
            Text("\(jam.guestCount) \(jam.guestCount == 1 ? "guest" : "guests") will be disconnected.")
                .foregroundStyle(.secondary)
            HStack {
                Button("Keep it going") {
                    confirmStop = false
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Stop the jam", role: .destructive) {
                    confirmStop = false
                    jam.stop()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(.vertical, 4)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text("Nimbrung").font(.headline)
                Text("\(jam.settings.name) · \(status)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    private var status: String {
        switch jam.phase {
        case .stopped: "not running"
        case .failed: "couldn’t start"
        case .starting: "starting, \(jam.doneCount) of \(jam.steps.count)"
        case .live: jam.liveSince.map { "live since \($0.formatted(date: .omitted, time: .shortened))" } ?? "live"
        }
    }

    private func startButton(title: String = "Start the jam", hint: String?, local: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { jam.start(local: local) } label: {
                Label(title, systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large).tint(.nimbrungRed)
            if let hint { Text(hint).font(.caption).foregroundStyle(.secondary) }
        }
    }

    /// No tunnel, no cloudflared: for a party where everyone is on this Wi-Fi.
    private var wifiButton: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { jam.start(local: true) } label: {
                Label("Start on Wi-Fi only", systemImage: "wifi").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered).controlSize(.large)
            Text("No tunnel. Guests must be on the same Wi-Fi as this Mac.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var invite: some View {
        HStack(spacing: 12) {
            if let qr = qrImage(jam.inviteURL) {
                Image(nsImage: qr).interpolation(.none).resizable()
                    .frame(width: 72, height: 72).padding(5)
                    .background(.white, in: RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(inviteCaption).font(.caption).foregroundStyle(.secondary)
                Text(jam.inviteURL.isEmpty ? "Shows once the room is up" : jam.inviteURL
                    .replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                    .font(.callout.weight(.medium)).lineLimit(1).truncationMode(.middle)
                    .textSelection(.enabled)
                // Works while stopped, so the link can go out before the party.
                Button(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(jam.inviteURL, forType: .string)
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(2)); copied = false }
                }
                .buttonStyle(.bordered).controlSize(.small)
                .disabled(jam.inviteURL.isEmpty)
            }
        }
    }

    private var inviteCaption: String {
        jam.local && jam.isRunning ? "Wi-Fi invite link"
            : jam.isLive ? "Invite link" : "Invite link · works once you’re live"
    }

    private func menuButton(_ title: String, key: String? = nil, enabled: Bool = true,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                if let key { Text(key).foregroundStyle(.secondary) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .padding(.vertical, 3)
    }

    // Always this Mac's own address, never the public one: the host key stays
    // off the tunnel, and the server shows the join code and QR only to this
    // computer and to guests.
    private func open(_ path: String) {
        if let url = URL(string: "http://localhost:8080" + path) { NSWorkspace.shared.open(url) }
    }

    // The host key lives in jam.env; read it at the click, never keep it around.
    private func openHost() {
        let text = (try? String(contentsOfFile: JamEnv.path, encoding: .utf8)) ?? ""
        let key = JamEnv.parse(text)["HOST_KEY"] ?? ""
        let encoded = key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        open("/host?key=\(encoded)")
    }

    private func quit() {
        jam.stop()
        NSApp.terminate(nil)
    }
}

struct StepRow: View {
    let step: Step
    var body: some View {
        HStack(spacing: 10) {
            Group {
                switch step.state {
                case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                case .running: ProgressView().controlSize(.small)
                case .waiting: Image(systemName: "circle").foregroundStyle(.tertiary)
                }
            }
            .frame(width: 18)
            Text(step.title).font(.callout.weight(.medium))
            Spacer()
            Text(step.detail).font(.caption.weight(.semibold))
                .foregroundStyle(step.state == .done ? .green : .secondary)
        }
        .frame(height: 24)
    }
}

func qrImage(_ text: String) -> NSImage? {
    guard !text.isEmpty else { return nil }
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    let rep = NSCIImageRep(ciImage: output)
    let image = NSImage(size: rep.size)
    image.addRepresentation(rep)
    return image
}

// MARK: - Menu-bar glyph: a jar, filled while starting or live

func jarGlyph(filled: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
        NSColor.black.setFill()
        NSColor.black.setStroke()
        NSBezierPath(roundedRect: NSRect(x: 5.5, y: 1.5, width: 7, height: 2.6), xRadius: 1, yRadius: 1).fill()
        let body = NSBezierPath(roundedRect: NSRect(x: 3.75, y: 4.75, width: 10.5, height: 11.5), xRadius: 2.8, yRadius: 2.8)
        body.lineWidth = 1.5
        if filled { body.fill() } else { body.stroke() }
        return true
    }
    image.isTemplate = true
    return image
}

// MARK: - App

/// Owns the jam so launch can open the setup window before the panel exists.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let jam = Jam()

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !jam.settings.exists { SetupWindow.show(jam: jam) }
    }
}

@main
struct NimbrungApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var app

    var body: some Scene {
        MenuBarExtra {
            JamPanel().environment(app.jam)
        } label: {
            Image(nsImage: jarGlyph(filled: app.jam.isRunning))
                .accessibilityLabel(app.jam.isLive ? "Nimbrung, live" : "Nimbrung")
        }
        .menuBarExtraStyle(.window)
    }
}
