import SwiftUI

/// Confetti, "mission passed" overlay and the rating request, drawn above everything
struct EffectsLayer: View {
    var body: some View {
        ZStack {
            Confetti()
            DayCompleteOverlay()
            RatingRequest()
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}

// region Confetti (react-native-confetti: 25 pieces, 20ms apart, 2s fall)

private let confettiColors: [Color] = [
    Color(red: 242 / 255, green: 102 / 255, blue: 69 / 255), Color(red: 1, green: 199 / 255, blue: 92 / 255),
    Color(red: 122 / 255, green: 199 / 255, blue: 163 / 255), Color(red: 77 / 255, green: 194 / 255, blue: 217 / 255),
    Color(red: 148 / 255, green: 99 / 255, blue: 140 / 255),
]

private struct Piece {
    let x: CGFloat, delay: Double, color: Color, size: CGFloat, spin: Double, wobble: Double
}

private struct Confetti: View {
    @State private var started: Date?
    @State private var pieces = [Piece]()

    var body: some View {
        TimelineView(.animation(paused: started == nil)) { context in
            Canvas { g, size in
                guard let started else { return }
                let time = context.date.timeIntervalSince(started) * 1000
                for p in pieces {
                    let local = (time - p.delay) / 2000
                    guard (0...1).contains(local) else { continue }
                    let x = p.x * size.width + CGFloat(sin(local * p.wobble * .pi)) * 20
                    let y = -p.size + CGFloat(local) * (size.height + 2 * p.size)
                    var piece = g
                    piece.translateBy(x: x, y: y)
                    piece.rotate(by: .degrees(p.spin * local))
                    piece.fill(Path(CGRect(x: -p.size / 2, y: -p.size / 4, width: p.size, height: p.size / 2)), with: .color(p.color))
                }
            }
        }
        .onChange(of: Effects.shared.confettiKey) {
            pieces = (0..<25).map { i in
                Piece(x: .random(in: 0...1), delay: Double(i) * 20, color: confettiColors.randomElement()!,
                      size: 6 + .random(in: 0...6), spin: .random(in: 0...720), wobble: .random(in: 0...6))
            }
            started = Date()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { if let s = started, Date().timeIntervalSince(s) >= 2.5 { started = nil } }
        }
    }
}

// endregion

private struct DayCompleteOverlay: View {
    @State private var opacity = 0.0
    @State private var showing = false

    var body: some View {
        VStack {
            Text(t("missionPassed")).foregroundStyle(Color(red: 153 / 255, green: 126 / 255, blue: 40 / 255))
            Text(t("respect")).foregroundStyle(.white)
        }
        .font(.system(size: 40)).multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.7))
        .opacity(opacity)
        .accessibilityHidden(!showing)
        .onChange(of: Effects.shared.dayCompleteKey) {
            // Ignored while already showing, like the RN overlay
            if showing { return }
            showing = true
            withAnimation(.linear(duration: 9)) { opacity = 1 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 9) {
                withAnimation(.linear(duration: 1)) { opacity = 0 }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { showing = false }
            }
        }
    }
}
