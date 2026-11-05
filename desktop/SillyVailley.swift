// Die Mac-App: ein eigenes Fenster für das Spiel. Sie startet den lokalen Server, falls noch keiner läuft,
// und beendet ihn wieder, wenn sie ihn selbst gestartet hat. Das Spiel selbst bleibt unverändert im Projektordner.

import Cocoa
import WebKit

let settings = Bundle.main.infoDictionary ?? [:]
let projectDir = settings["SVProject"] as? String ?? ""
let nodePath = settings["SVNode"] as? String ?? "/opt/homebrew/bin/node"
let toolPath = settings["SVPath"] as? String ?? "/usr/bin:/bin"
let environment = ProcessInfo.processInfo.environment
let port = environment["PORT"] ?? "4600"
let gameURL = URL(string: "http://localhost:\(port)/")!
let logFile = NSString(string: "~/Library/Logs/Silly Vailley.log").expandingTildeInPath

let waitingPage = """
<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1a2b;color:#e8f0f7;font:20px Menlo,monospace">Silly Vailley startet ...</body>
"""

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var window: NSWindow!
  var web: WKWebView!
  var server: Process?
  var signalSource: DispatchSourceSignal?

  func applicationDidFinishLaunching(_ notification: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.loadHTMLString(waitingPage, baseURL: nil)

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Silly Vailley"
    window.contentView = web
    window.minSize = NSSize(width: 800, height: 560)
    window.setFrameAutosaveName("SillyVailleyFenster")
    if !window.setFrameUsingName("SillyVailleyFenster") { window.center() }
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    // Auch beim Abmelden oder einem kill läuft das normale Beenden.
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { NSApp.terminate(nil) }
    source.resume()
    signalSource = source

    isServerUp { up in
      if !up { self.startServer() }
      self.waitForServer(triesLeft: 120)
    }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  /// Wer gerade arbeitet, würde mit dem Server gestoppt. Das entscheidet der Mensch.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let server, server.isRunning else { return .terminateNow }
    runningAgents { count in
      if count == 0 || self.confirmQuit(count) {
        server.terminate()
        DispatchQueue.global().async {
          server.waitUntilExit()
          DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) }
        }
      } else {
        NSApp.reply(toApplicationShouldTerminate: false)
      }
    }
    return .terminateLater
  }

  func confirmQuit(_ count: Int) -> Bool {
    let alert = NSAlert()
    alert.messageText = count == 1 ? "Ein Agent arbeitet noch." : "\(count) Agenten arbeiten noch."
    alert.informativeText = "Beim Beenden werden laufende Arbeiten gestoppt. Was bis dahin verbraucht wurde, bleibt verbucht."
    alert.addButton(withTitle: "Weiterlaufen lassen")
    alert.addButton(withTitle: "Beenden")
    return alert.runModal() == .alertSecondButtonReturn
  }

  /* ---------- Server ---------- */

  func isServerUp(_ done: @escaping (Bool) -> Void) {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/companies")!)
    request.timeoutInterval = 1.5
    URLSession.shared.dataTask(with: request) { _, response, _ in
      let up = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(up) }
    }.resume()
  }

  func runningAgents(_ done: @escaping (Int) -> Void) {
    URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:\(port)/api/companies")!) { data, _, _ in
      var total = 0
      if let data, let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
        total = list.reduce(0) { $0 + (($1["runningAgents"] as? Int) ?? 0) }
      }
      DispatchQueue.main.async { done(total) }
    }.resume()
  }

  func startServer() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: nodePath)
    process.arguments = ["server/main.ts"]
    process.currentDirectoryURL = URL(fileURLWithPath: projectDir)
    var env = environment
    env["PATH"] = toolPath
    env["SILLYVAILLEY_BAUPUNKTE"] = env["SILLYVAILLEY_BAUPUNKTE"] ?? "unendlich"
    process.environment = env
    FileManager.default.createFile(atPath: logFile, contents: nil)
    if let log = FileHandle(forWritingAtPath: logFile) {
      process.standardOutput = log
      process.standardError = log
    }
    do {
      try process.run()
      server = process
    } catch {
      fail("Der Server liess sich nicht starten: \(error.localizedDescription)")
    }
  }

  func waitForServer(triesLeft: Int) {
    isServerUp { up in
      if up {
        self.web.load(URLRequest(url: gameURL))
      } else if triesLeft <= 0 || self.server?.isRunning == false {
        self.fail("Der Server antwortet nicht. Näheres steht in \(logFile).")
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForServer(triesLeft: triesLeft - 1) }
      }
    }
  }

  func fail(_ text: String) {
    let alert = NSAlert()
    alert.messageText = "Silly Vailley startet nicht"
    alert.informativeText = text
    alert.runModal()
    NSApp.terminate(nil)
  }

  /* ---------- Fenster ---------- */

  /// Downloads und "Starten" gehen in den normalen Browser, dort laufen Ergebnisse wie jede andere Seite.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload, let url = action.request.url {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  /// Das Laden einer Markdown-Datei für Rollen und Fähigkeiten.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
  }

  func buildMenu() {
    let main = NSMenu()
    let add = { (title: String, items: [NSMenuItem]) in
      let holder = NSMenuItem()
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      holder.submenu = menu
      main.addItem(holder)
    }
    let item = { (title: String, action: Selector, key: String) in NSMenuItem(title: title, action: action, keyEquivalent: key) }
    add("Silly Vailley", [item("Silly Vailley ausblenden", #selector(NSApplication.hide(_:)), "h"), .separator(), item("Silly Vailley beenden", #selector(NSApplication.terminate(_:)), "q")])
    // Ohne dieses Menü funktionieren Kopieren und Einsetzen in den Textfeldern nicht.
    add("Bearbeiten", [
      item("Widerrufen", Selector(("undo:")), "z"), item("Wiederholen", Selector(("redo:")), "Z"), .separator(),
      item("Ausschneiden", #selector(NSText.cut(_:)), "x"), item("Kopieren", #selector(NSText.copy(_:)), "c"),
      item("Einsetzen", #selector(NSText.paste(_:)), "v"), item("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
    ])
    add("Darstellung", [item("Neu laden", #selector(reload), "r"), item("Vollbild", #selector(NSWindow.toggleFullScreen(_:)), "f")])
    add("Fenster", [item("Im Dock ablegen", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Schliessen", #selector(NSWindow.performClose(_:)), "w")])
    NSApp.mainMenu = main
  }

  @objc func reload() { web.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
