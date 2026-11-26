import ExpoModulesCore
import Foundation

/// Error a JavaScript handler reported (its text is already localized), or no answer in time.
public enum IntentBridgeError: Error {
  case message(String)
  case timeout
}

/// Hands App Intents (Siri, Shortcuts, Control Center, Spotlight) to the JavaScript side and waits for the answer.
///
/// The intents live in the app target (`targets/widget/_shared`); they call `IntentBridge.shared.call`. React Native
/// starts with the scene, so after a launch in the background nothing answers until the app comes forward: requests
/// wait in `queued` until JavaScript calls `ready()`.
public final class IntentBridge: @unchecked Sendable {
  public static let shared = IntentBridge()

  private let lock = NSLock()
  private var ready = false
  private var emit: (([String: Any]) -> Void)?
  private var queued: [[String: Any]] = []
  private var waiting: [String: CheckedContinuation<Data, Error>] = [:]

  /// JavaScript is running and listening.
  public var isReady: Bool {
    lock.lock()
    defer { lock.unlock() }
    return ready
  }

  /// Runs `action` in JavaScript and returns its result as JSON.
  public func call(_ action: String, _ args: [String: Any] = [:], timeout: TimeInterval = 25) async throws -> Data {
    let id = UUID().uuidString
    return try await withCheckedThrowingContinuation { continuation in
      let request: [String: Any] = ["id": id, "action": action, "args": args]
      lock.lock()
      waiting[id] = continuation
      let send = ready ? emit : nil
      if send == nil { queued.append(request) }
      lock.unlock()
      send?(request)
      DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [weak self] in
        self?.finish(id, .failure(IntentBridgeError.timeout))
      }
    }
  }

  func attach(_ send: @escaping ([String: Any]) -> Void) {
    lock.lock()
    emit = send
    ready = false
    lock.unlock()
  }

  func detach() {
    lock.lock()
    emit = nil
    ready = false
    lock.unlock()
  }

  func markReady() {
    lock.lock()
    ready = true
    let pending = queued
    queued = []
    let send = emit
    lock.unlock()
    pending.forEach { send?($0) }
  }

  func respond(_ id: String, json: String?, error: String?) {
    if let error {
      finish(id, .failure(IntentBridgeError.message(error)))
    } else {
      finish(id, .success(Data((json ?? "null").utf8)))
    }
  }

  private func finish(_ id: String, _ result: Result<Data, Error>) {
    lock.lock()
    let continuation = waiting.removeValue(forKey: id)
    if continuation != nil { queued.removeAll { ($0["id"] as? String) == id } }
    lock.unlock()
    continuation?.resume(with: result)
  }
}

/// JavaScript side of `IntentBridge` (`src/lib/shortcuts.ts`).
public class ShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Shortcuts")

    Events("onRequest")

    OnCreate {
      IntentBridge.shared.attach { [weak self] request in
        self?.sendEvent("onRequest", request)
      }
    }

    OnDestroy {
      IntentBridge.shared.detach()
    }

    /// The listener is set: queued requests go out now.
    Function("ready") {
      IntentBridge.shared.markReady()
    }

    Function("respond") { (id: String, json: String?, error: String?) in
      IntentBridge.shared.respond(id, json: json, error: error)
    }

    /// `shortcuts.json` changed: the app target refreshes Siri's parameter phrases and the Spotlight index.
    /// The host class lives in the app target, which this pod cannot import, so it is looked up by name.
    Function("catalogChanged") {
      let selector = NSSelectorFromString("catalogChanged")
      if let host = NSClassFromString("SonalisIntentsHost") as? NSObject.Type, host.responds(to: selector) {
        _ = host.perform(selector)
      }
    }
  }
}
