import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate, RNAppAuthAuthorizationFlowManager {
  weak var authorizationFlowManagerDelegate: RNAppAuthAuthorizationFlowManagerDelegate?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    true
  }

  /// Returns true when the URL was the redirect of an in-progress react-native-secure-auth flow.
  func resumeAuthorizationFlow(with url: URL) -> Bool {
    authorizationFlowManagerDelegate?.resumeExternalUserAgentFlow(with: url) ?? false
  }
}
