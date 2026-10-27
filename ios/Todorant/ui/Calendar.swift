import SwiftUI

/// Month names in the app language
private func standaloneMonth(_ month: Int, short: Bool) -> String {
    let f = DateFormatter()
    f.locale = I18n.locale
    return (short ? f.shortStandaloneMonthSymbols : f.standaloneMonthSymbols)[month - 1]
}

/// The first of the month containing [date]
private func monthStart(_ date: Date) -> Date { calendar.date(from: calendar.dateComponents([.year, .month], from: date))! }

/**
 * A month grid with arrows (react-native-calendars' Calendar and the planning Month view).
 * Days before [minDate] are disabled; [selected] is highlighted.
 */
struct MonthCalendar: View {
    @Binding var month: Date
    var selected: Date? = nil
    var minDate: Date? = nil
    let onDayClick: (Date) -> Void

    var body: some View {
        let start = monthStart(month)
        // firstDayOfWeekSafe: 0 = Sunday
        let firstDay = Settings.firstDayOfWeekSafe
        let symbols: [String] = {
            let f = DateFormatter()
            f.locale = I18n.locale
            return f.shortStandaloneWeekdaySymbols
        }()
        let days = calendar.range(of: .day, in: .month, for: start)!.count
        let weekday = calendar.component(.weekday, from: start) - 1 // 0 = Sunday
        let offset = (weekday - firstDay + 7) % 7
        let today = Date().startOfDay
        VStack(spacing: 0) {
            HStack {
                Button { month = start.plusMonths(-1) } label: { Image(systemName: "chevron.left").frame(width: 28, height: 28) }
                    .accessibilityLabel("<")
                Text("\(capitalizeSentence(standaloneMonth(calendar.component(.month, from: start), short: false))) \(String(calendar.component(.year, from: start)))")
                    .frame(maxWidth: .infinity)
                Button { month = start.plusMonths(1) } label: { Image(systemName: "chevron.right").frame(width: 28, height: 28) }
                    .accessibilityLabel(">")
            }
            .buttonStyle(.plain).foregroundStyle(Colors.text).padding(.vertical, 8)
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(symbols[(firstDay + i) % 7]).font(.system(size: 12)).foregroundStyle(Colors.text.opacity(0.6)).frame(maxWidth: .infinity)
                }
            }
            ForEach(0..<((offset + days + 6) / 7), id: \.self) { week in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { d in
                        let number = week * 7 + d - offset + 1
                        ZStack {
                            if (1...days).contains(number) {
                                let day = start.plusDays(number - 1)
                                let enabled = minDate.map { day >= $0.startOfDay } ?? true
                                let isSelected = selected.map { calendar.isDate($0, inSameDayAs: day) } ?? false
                                Button { onDayClick(day) } label: {
                                    Text("\(number)")
                                        .foregroundStyle(isSelected ? .white : day == today ? Colors.link : Colors.text)
                                        .frame(width: 36, height: 36)
                                        .background(isSelected ? Colors.link : .clear, in: Circle())
                                        .opacity(enabled ? 1 : 0.35)
                                }
                                .buttonStyle(.plain).disabled(!enabled)
                                .accessibilityLabel(day.dateString)
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 42)
                    }
                }
            }
        }
        .padding(.horizontal, 8)
        // Day numbers sit in fixed circles, seven to a row: accessibility text sizes spilled out of them
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// react-native-month-picker: months from next month up to 100 years ahead
struct MonthYearPicker: View {
    let selected: String?
    let onPick: (String) -> Void
    @State private var year: Int

    private let min: (Int, Int)
    private let maxYear: Int

    init(selected: String?, onPick: @escaping (String) -> Void) {
        self.selected = selected
        self.onPick = onPick
        let next = Date().plusMonths(1)
        min = (calendar.component(.year, from: next), calendar.component(.month, from: next))
        maxYear = calendar.component(.year, from: Date()) + 100
        _year = State(initialValue: selected.flatMap { Int($0.prefix(4)) } ?? min.0)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { if year > min.0 { year -= 1 } } label: { Image(systemName: "chevron.left").frame(width: 28, height: 28) }
                Text(String(year)).font(Fonts.text(18)).frame(maxWidth: .infinity)
                Button { if year < maxYear { year += 1 } } label: { Image(systemName: "chevron.right").frame(width: 28, height: 28) }
            }
            .buttonStyle(.plain).foregroundStyle(Colors.text)
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(0..<4, id: \.self) { col in
                        let m = row * 4 + col + 1
                        let value = String(format: "%04d-%02d", year, m)
                        let enabled = (year, m) >= min
                        let isSelected = value == selected
                        Button { onPick(value) } label: {
                            Text(capitalizeSentence(standaloneMonth(m, short: true)))
                                .foregroundStyle(isSelected ? Colors.invertedText : enabled ? Colors.text : Colors.placeholder)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(isSelected ? Colors.primary : .clear, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain).disabled(!enabled).padding(4)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }
}
