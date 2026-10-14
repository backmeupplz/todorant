import SwiftUI

private struct Rank {
    let color: Color
    let count: Int
    var title: String { t("rank\(count)Title") }
    var description: String { t("rank\(count)Description") }
}

private let gray = Color(UIColor(rgb: 0x888888))

struct HeroScreen: View {
    var body: some View {
        let rank = Hero.rank
        let previous = rank == -1 ? Array(Hero.ranks.dropLast()) : Hero.ranks.filter { $0 < rank }
        ScrollView {
            VStack(spacing: 0) {
                RankCard(rank: Rank(color: Colors.forRank(Hero.rankIndex)[0], count: rank),
                         nextRank: Rank(color: Colors.forRank(Hero.rankIndex + 1)[0], count: Hero.nextRank), progress: Hero.progress)
                if !previous.isEmpty {
                    Divider()
                    ForEach(Array(previous.enumerated().reversed()), id: \.offset) { i, r in RankCard(rank: Rank(color: Colors.forRank(i)[0], count: r)) }
                }
            }
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Colors.background)
        .navigationTitle(t("heroProfileTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { InfoButton(message: "infoHero") } }
    }
}

private struct CircleWithText: View {
    let color: Color
    let count: Int
    var body: some View {
        HStack(spacing: 16) {
            Circle().stroke(color, lineWidth: 6).frame(width: 14, height: 14).padding(3)
            Text("\(count) \(t("points"))").font(Fonts.rounded(22, .bold)).foregroundStyle(color)
        }
    }
}

/// A finished rank when [nextRank] is nil
private struct RankCard: View {
    let rank: Rank
    var nextRank: Rank? = nil
    var progress: Double? = nil
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        VStack(alignment: .leading, spacing: 0) {
            if let nextRank { CircleWithText(color: nextRank.color, count: nextRank.count) }
            VStack(alignment: .leading, spacing: 0) {
                if let nextRank {
                    Text("\(nextRank.count - Hero.points) \(t("pointsTillNextLevel"))").font(Fonts.rounded(15)).foregroundStyle(gray)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(t("level")) \(rank.count)").font(Fonts.rounded(17)).foregroundStyle(gray)
                    Text(rank.title).font(Fonts.rounded(20)).foregroundStyle(Colors.text)
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Colors.cardBackground, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(dark ? Color.white.opacity(0.1) : Color.black.opacity(0.03)))
                .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                .padding(.vertical, 8).padding(.trailing, 4)
                Text(rank.description).font(Fonts.rounded(15)).foregroundStyle(gray)
            }
            .padding(.leading, 36)
            // The rank's line: filled up to the progress
            .background(alignment: .leading) {
                GeometryReader { g in
                    ZStack(alignment: .bottom) {
                        Capsule().fill(dark ? Color.white.opacity(0.2) : Color.black.opacity(0.2))
                        Capsule().fill(rank.color).frame(height: g.size.height * min(max(progress ?? 1, 0), 1))
                    }
                }
                .frame(width: 2).padding(.leading, 9)
            }
            .padding(.vertical, 8).padding(.trailing, 16)
            if nextRank != nil { CircleWithText(color: rank.color, count: rank.count) }
        }
        .padding(16)
    }
}
