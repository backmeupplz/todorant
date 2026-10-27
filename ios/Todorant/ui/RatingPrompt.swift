import StoreKit
import SwiftUI

/**
 * Asks for an App Store rating with StoreKit's own prompt only, right after an "all done" day: once the app was used on
 * 3 days, at least 3 days after the first, and 3 days were all done. At most twice per install, the second 120+ days
 * later on a newer version. Nothing leaves the device.
 */
@Observable
final class RatingPrompt {
    static let shared = RatingPrompt()
    var due = false
    /// Not after an error in the same session
    static var errored = false

    private static var today: Int { Calendar.current.ordinality(of: .day, in: .era, for: Date()) ?? 0 }
    private static var version: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }
    private static func int(_ key: String) -> Int? { Prefs.shared.get("rating.\(key)") as? Int }
    private static func set(_ key: String, _ value: Any?) { Prefs.shared.set("rating.\(key)", value) }

    static func appOpened() {
        if int("firstUseDay") == nil {
            set("firstUseDay", today)
            // The old prompt (100 completed todos) already used one of the two requests
            if Session.askedToRate { set("requests", 1); set("lastRequestDay", today); set("lastRequestVersion", version) }
        }
        if int("lastActiveDay") != today { set("lastActiveDay", today); set("activeDays", (int("activeDays") ?? 0) + 1) }
    }

    /// Every planned todo of [day] is done; counts each day once
    static func dayCompleted(_ day: String) {
        if Prefs.string("rating.lastAllDoneDay") == day { return }
        set("lastAllDoneDay", day)
        let allDoneDays = (int("allDoneDays") ?? 0) + 1
        set("allDoneDays", allDoneDays)
        let requests = int("requests") ?? 0
        guard !errored, shouldAsk(today: today, firstUseDay: int("firstUseDay") ?? today, activeDays: int("activeDays") ?? 0, allDoneDays: allDoneDays,
                                  requests: requests, lastRequestDay: int("lastRequestDay"), lastRequestVersion: int("lastRequestVersion") ?? 0,
                                  version: version) else { return }
        set("requests", requests + 1)
        set("lastRequestDay", today)
        set("lastRequestVersion", version)
        shared.due = true
    }

    static func shouldAsk(today: Int, firstUseDay: Int, activeDays: Int, allDoneDays: Int, requests: Int, lastRequestDay: Int?,
                          lastRequestVersion: Int, version: Int) -> Bool {
        guard activeDays >= 3, today - firstUseDay >= 3, allDoneDays >= 3 else { return false }
        switch requests {
        case 0: return true
        case 1: return lastRequestDay.map { today - $0 >= 120 } == true && version > lastRequestVersion
        default: return false
        }
    }
}

/// StoreKit's prompt once [RatingPrompt] is due
struct RatingRequest: View {
    @Environment(\.requestReview) private var requestReview

    var body: some View {
        Color.clear.onChange(of: RatingPrompt.shared.due) { _, due in
            guard due else { return }
            RatingPrompt.shared.due = false
            // After the 10 s "mission passed" overlay when it shows, else a beat after the last checkmark
            DispatchQueue.main.asyncAfter(deadline: .now() + (Todos.shouldShowDayCompletion() ? 11 : 2)) { requestReview() }
        }
    }
}
