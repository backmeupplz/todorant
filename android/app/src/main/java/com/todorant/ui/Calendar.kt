package com.todorant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.I18n
import com.todorant.data.Settings
import com.todorant.logic.capitalizeSentence
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle

/**
 * A month grid with arrows (react-native-calendars' Calendar and the planning Month view).
 * Days before [minDate] are disabled; [selected] is highlighted.
 */
@Composable
fun MonthCalendar(
    initialMonth: YearMonth,
    onDayClick: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    selected: LocalDate? = null,
    minDate: LocalDate? = null,
    onMonthChange: (YearMonth) -> Unit = {},
) {
    var month by remember(initialMonth) { mutableStateOf(initialMonth) }
    LaunchedEffect(month) { onMonthChange(month) }
    val locale = I18n.locale()
    // firstDayOfWeekSafe: 0 = Sunday
    val firstDay = if (Settings.firstDayOfWeekSafe == 0) DayOfWeek.SUNDAY else DayOfWeek.of(Settings.firstDayOfWeekSafe)
    Column(modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            MIcon(MaterialIcons.AutoMirrored.Filled.KeyboardArrowLeft, Colors.text.copy(alpha = 0.5f), 28.dp) { month = month.minusMonths(1) }
            Text(
                "${capitalizeSentence(month.month.getDisplayName(TextStyle.FULL_STANDALONE, locale))} ${month.year}",
                color = Colors.text, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)
            )
            MIcon(MaterialIcons.AutoMirrored.Filled.KeyboardArrowRight, Colors.text.copy(alpha = 0.5f), 28.dp) { month = month.plusMonths(1) }
        }
        Row(Modifier.fillMaxWidth()) {
            for (i in 0 until 7) {
                Text(
                    firstDay.plus(i.toLong()).getDisplayName(TextStyle.SHORT_STANDALONE, locale),
                    color = Colors.text.copy(alpha = 0.6f), fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)
                )
            }
        }
        val first = month.atDay(1)
        val offset = (first.dayOfWeek.value - firstDay.value + 7) % 7
        val cells = offset + month.lengthOfMonth()
        val today = LocalDate.now()
        for (week in 0 until (cells + 6) / 7) {
            Row(Modifier.fillMaxWidth()) {
                for (d in 0 until 7) {
                    val dayNumber = week * 7 + d - offset + 1
                    Box(Modifier.weight(1f).aspectRatio(1.2f), contentAlignment = Alignment.Center) {
                        if (dayNumber in 1..month.lengthOfMonth()) {
                            val day = month.atDay(dayNumber)
                            val enabled = minDate == null || !day.isBefore(minDate)
                            val isSelected = day == selected
                            Box(
                                Modifier.padding(2.dp).aspectRatio(1f).clip(CircleShape)
                                    .background(if (isSelected) Color(0xFF1E90FF) else Color.Transparent)
                                    .clickable(enabled = enabled) { onDayClick(day) },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "$dayNumber",
                                    color = when { isSelected -> Color.White; day == today -> Color(0xFF1E90FF); else -> Colors.text },
                                    modifier = Modifier.alpha(if (enabled) 1f else 0.35f),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
