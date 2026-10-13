package com.todorant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.Hero
import com.todorant.data.Settings
import com.todorant.t
import com.todorant.ui.Colors
import com.todorant.ui.Divider
import com.todorant.ui.Fonts
import com.todorant.ui.InfoButton
import com.todorant.ui.StackScreen

private class Rank(val color: Color, val count: Int) {
    val title get() = t("rank${count}Title")
    val description get() = t("rank${count}Description")
}

private val gray = Color(0xFF888888)

@Composable
fun HeroScreen() {
    StackScreen(t("heroProfileTitle"), actions = { InfoButton("infoHero") }) {
        val rank = Hero.rank
        val previous = if (rank == -1) Hero.ranks.dropLast(1) else Hero.ranks.filter { it < rank }
        Column(Modifier.verticalScroll(rememberScrollState())) {
            RankCard(
                Rank(Colors.forRank(Hero.rankIndex)[0], rank),
                nextRank = Rank(Colors.forRank(Hero.rankIndex + 1)[0], Hero.nextRank),
                progress = Hero.progress,
            )
            if (previous.isNotEmpty()) {
                Divider()
                previous.mapIndexed { i, r -> Rank(Colors.forRank(i)[0], r) }.reversed().forEach { RankCard(it) }
            }
        }
    }
}

@Composable
private fun CircleWithText(color: Color, count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(20.dp).border(6.dp, color, CircleShape))
        Text("$count ${t("points")}", color = color, fontFamily = Fonts.roundedBold, fontSize = 22.sp, modifier = Modifier.padding(start = 16.dp))
    }
}

/** A finished rank when [nextRank] is null */
@Composable
private fun RankCard(rank: Rank, nextRank: Rank? = null, progress: Float? = null) {
    val dark = Settings.isDark
    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        if (nextRank != null) CircleWithText(nextRank.color, nextRank.count)
        Row(Modifier.height(IntrinsicSize.Min).padding(vertical = 8.dp).padding(end = 16.dp)) {
            Box(
                Modifier.padding(horizontal = 9.dp).width(2.dp).fillMaxHeight().clip(RoundedCornerShape(10.dp))
                    .background(if (dark) Color(0x33FFFFFF) else Color(0x33000000)),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Box(Modifier.fillMaxWidth().fillMaxHeight((progress ?: 1f).coerceIn(0f, 1f)).clip(RoundedCornerShape(10.dp)).background(rank.color))
            }
            Column(Modifier.padding(start = 16.dp)) {
                if (nextRank != null) {
                    Text("${nextRank.count - Hero.points} ${t("pointsTillNextLevel")}", fontFamily = Fonts.roundedRegular, fontSize = 15.sp, color = gray)
                }
                Column(
                    Modifier.padding(vertical = 8.dp).padding(end = 4.dp).fillMaxWidth()
                        .shadow(1.dp, RoundedCornerShape(14.dp))
                        .background(if (dark) Color(0xFF1F1F1F) else Color.White, RoundedCornerShape(14.dp))
                        .border(1.dp, if (dark) Color(0x1AFFFFFF) else Color(0x03000000), RoundedCornerShape(14.dp))
                        .padding(16.dp)
                ) {
                    Text("${t("level")} ${rank.count}", fontSize = 17.sp, fontFamily = Fonts.roundedRegular, color = gray)
                    Text(rank.title, fontSize = 20.sp, fontFamily = Fonts.roundedRegular, color = Colors.text)
                }
                Text(rank.description, fontFamily = Fonts.roundedRegular, fontSize = 15.sp, color = gray)
            }
        }
        if (nextRank != null) CircleWithText(rank.color, rank.count)
    }
}
