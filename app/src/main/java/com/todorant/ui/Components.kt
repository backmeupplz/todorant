package com.todorant.ui

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.Db
import com.todorant.data.Hero
import com.todorant.data.Settings
import com.todorant.logic.capitalizeSentence
import com.todorant.logic.parseTitle
import com.todorant.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.format.TextStyle as DateTextStyle

/** Runs [query] off the main thread and re-runs it whenever the database or [keys] change */
@Composable
fun <T> dbState(vararg keys: Any?, initial: T, query: () -> T): T {
    val version by Db.changes.collectAsState()
    return produceState(initial, version, *keys) { value = withContext(Dispatchers.IO) { query() } }.value
}

val regularText @Composable get() = TextStyle(color = Colors.text, fontFamily = Fonts.textRegular, fontSize = 17.sp)

@Composable
fun TIcon(name: String, size: Dp = 28.dp, color: Color = Colors.text, modifier: Modifier = Modifier) {
    val fontSize = with(LocalDensity.current) { size.toSp() }
    Text(Icons.codes[name] ?: "?", fontFamily = Fonts.icons, fontSize = fontSize, color = color, modifier = modifier, lineHeight = fontSize)
}

/** IconButton from the RN app */
@Composable
fun IconBtn(
    name: String,
    color: Color? = null,
    fullColor: Boolean = false,
    size: Dp = 28.dp,
    disabled: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    TIcon(
        name, size, if (disabled) Color.Gray else color ?: Colors.defaultIcon,
        modifier.padding(horizontal = 6.dp).alpha(if (fullColor) 1f else 0.8f)
            .clip(RoundedCornerShape(50)).clickable(enabled = !disabled, onClick = onClick)
    )
}

@Composable
fun MIcon(icon: ImageVector, color: Color = Colors.text, size: Dp = 24.dp, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Icon(icon, null, tint = color, modifier = modifier.size(size).let { if (onClick != null) it.clip(RoundedCornerShape(50)).clickable(onClick = onClick) else it })
}

@Composable
fun InfoButton(message: String, modifier: Modifier = Modifier) {
    TIcon("-Icon-1", 28.dp, Colors.text, modifier.padding(end = 12.dp).alpha(0.5f).clip(RoundedCornerShape(50)).clickable { Ui.info(message) })
}

@Composable
fun Divider(color: Color = Colors.border, vertical: Dp = 6.dp, horizontal: Dp = 16.dp) {
    HorizontalDivider(Modifier.padding(horizontal = horizontal, vertical = vertical), 1.dp, color)
}

@Composable
fun SectionHeader(title: String) {
    Text(title, fontFamily = Fonts.textRegular, fontSize = 13.sp, color = Colors.border, modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 6.dp))
}

@Composable
fun TableItem(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .heightIn(min = 28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically, content = content)
        if (onClick != null) TIcon("chevron_right_outline_28", 24.dp, Colors.border)
    }
}

/** Title on the left, value on the right */
@Composable
fun ValueRow(title: String, value: String, onClick: (() -> Unit)? = null) = TableItem(onClick) {
    TableText(title, Modifier.weight(1f))
    TableText(value)
}

@Composable
fun TableText(text: String, modifier: Modifier = Modifier, color: Color = Colors.text) =
    Text(text, style = regularText.copy(color = color), modifier = modifier)

@Composable
fun TodorantSwitch(checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) = Switch(
    checked, onChange, enabled = enabled,
    colors = SwitchDefaults.colors(checkedTrackColor = Colors.primary, checkedThumbColor = Color.White, uncheckedTrackColor = Color.Gray, uncheckedThumbColor = Color.LightGray, uncheckedBorderColor = Color.Transparent),
)

/** TextAndSwitch: [title] is a translation key */
@Composable
fun TextAndSwitch(title: String, value: Boolean, onChange: (Boolean) -> Unit) {
    TableItem {
        TableText(t(title), Modifier.weight(1f).padding(end = 8.dp))
        TodorantSwitch(value, onChange)
    }
}

@Composable
fun CheckOrCross(ok: Boolean) = Icon(
    if (ok) MaterialIcons.Filled.Check else MaterialIcons.Filled.Close, null,
    tint = if (ok) Colors.success else Colors.destruct
)

@Composable
fun Spinner(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Colors.primary, modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
    }
}

@Composable
fun ProgressView(progress: Float, tint: Color, track: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(10.dp)).background(track)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).clip(RoundedCornerShape(10.dp)).background(tint))
    }
}

@Composable
fun SegmentedProgressView(completed: Int, total: Int) {
    val numberStyle = TextStyle(color = Colors.primary, fontFamily = Fonts.roundedRegular, fontSize = 22.sp)
    Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("$completed", style = numberStyle, modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.weight(1f).height(4.dp)) {
            if (total <= 20) {
                repeat(total) { i ->
                    Box(
                        Modifier.weight(1f).fillMaxHeight().padding(horizontal = 4.dp).clip(RoundedCornerShape(10.dp))
                            .background(if (i < completed) Colors.primary else Colors.text.copy(alpha = 0.2f))
                    )
                }
            } else {
                ProgressView(completed.toFloat() / total, Colors.primary, Colors.text.copy(alpha = 0.2f), Modifier.padding(horizontal = 4.dp))
            }
        }
        Text("$total", style = numberStyle, modifier = Modifier.padding(horizontal = 16.dp))
    }
}

private fun shortNumber(n: Int): String = when {
    n >= 1_000_000 -> "${(n / 100_000) / 10.0}M".replace(".0M", "M")
    n >= 1_000 -> "${(n / 100) / 10.0}K".replace(".0K", "K")
    else -> "$n"
}

@Composable
fun HeroButton() {
    val scheme = Colors.forRank(Hero.rankIndex)
    val tint = scheme[if (Settings.isDark) 2 else 3]
    val track = scheme[if (Settings.isDark) 3 else 2]
    Column(
        Modifier.padding(end = 16.dp).widthIn(min = 30.dp).clickable { Nav.go(Route.HERO) },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(shortNumber(Hero.points), color = tint, fontFamily = Fonts.roundedBold, fontSize = 22.sp)
        ProgressView(Hero.progress, tint, track, Modifier.width(30.dp))
    }
}

/**
 * HeaderScrollView: a large title that fades into a small centered header once scrolled past.
 * [content] fills a LazyColumn below the title row.
 */
@Composable
fun LargeTitleScreen(
    title: String,
    infoTitle: String,
    showsHeroButton: Boolean = false,
    state: LazyListState = rememberLazyListState(),
    bottomPadding: Dp = 0.dp,
    infoModifier: Modifier = Modifier,
    content: LazyListScope.() -> Unit,
) {
    val scrolled by remember { derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > 40 } }
    Column(Modifier.fillMaxSize().background(Colors.background).windowInsetsPadding(WindowInsets.statusBars)) {
        Box(Modifier.fillMaxWidth().height(56.dp)) {
            androidx.compose.animation.AnimatedVisibility(scrolled, enter = fadeIn(), exit = fadeOut()) {
                Box(Modifier.fillMaxSize()) {
                    Text(title, color = Colors.text, fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.align(Alignment.Center))
                    InfoButton(infoTitle, Modifier.align(Alignment.CenterEnd))
                    HorizontalDivider(Modifier.align(Alignment.BottomCenter), 1.dp, if (Settings.isDark) Color(0x1AFFFFFF) else Color(0x1A000000))
                }
            }
        }
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(bottom = bottomPadding)) {
            item("largeTitle") {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title, color = Colors.text, fontFamily = Fonts.displayBold, fontSize = 34.sp, lineHeight = 41.sp,
                        modifier = Modifier.padding(start = 16.dp)
                    )
                    InfoButton(infoTitle, infoModifier.padding(start = 12.dp))
                    Spacer(Modifier.weight(1f))
                    if (showsHeroButton && Settings.gamificationOn) HeroButton()
                }
            }
            content()
        }
    }
}

/** A full-width 56 dp bar below the status bar */
@Composable
fun Modifier.headerBar() = fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).height(56.dp)

/** Stack screen header with a back arrow, like the react-navigation stack headers */
@Composable
fun TopBar(title: String, onBack: (() -> Unit)? = { Nav.back() }, actions: @Composable RowScope.() -> Unit = {}) {
    Box(Modifier.background(Colors.background).headerBar()) {
        if (onBack != null) MIcon(
            MaterialIcons.AutoMirrored.Filled.ArrowBack, Colors.text.copy(alpha = 0.5f),
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 12.dp), onClick = onBack
        )
        Text(
            title, color = Colors.text, fontSize = 18.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center, modifier = Modifier.align(Alignment.Center).padding(horizontal = 96.dp)
        )
        Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** A stack screen: header + content on the app background */
@Composable
fun StackScreen(title: String, actions: @Composable RowScope.() -> Unit = {}, onBack: (() -> Unit)? = { Nav.back() }, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Colors.background)) {
        TopBar(title, onBack, actions)
        content()
    }
}

val brandGradient = Brush.linearGradient(listOf(Color(0xFF1148B9), Color(0xFF5C9BFF)))

/** The floating gradient "+" button */
@Composable
fun BoxScope.PlusButton(modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit = { Nav.go(Route.add()) }) {
    Box(
        modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 24.dp).size(48.dp, 64.dp)
            .clip(RoundedCornerShape(28.dp)).background(brandGradient).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { TIcon("add_outline_28", 20.dp, Color.White) }
}

/** Day/month or user section header (TodoHeader) */
@Composable
fun TodoHeader(item: String, date: Boolean = false, hidePlus: Boolean = false, plusEnabled: Boolean = true, labelModifier: Modifier = Modifier) {
    val label = if (date && item.length == 10) {
        val weekday = parseTitle(item)?.dayOfWeek?.getDisplayName(DateTextStyle.FULL, com.todorant.I18n.locale()) ?: ""
        "$item, ${capitalizeSentence(weekday)}"
    } else item
    Row(Modifier.padding(top = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label, color = Colors.primary, fontFamily = Fonts.roundedRegular,
            modifier = labelModifier.background(Color(0x0FFF641A), RoundedCornerShape(topEnd = 6.dp, bottomEnd = 6.dp))
                .padding(start = 16.dp, end = 12.dp, top = 4.dp, bottom = 4.dp)
        )
        if (!hidePlus) IconBtn("add_outline_28", Colors.primary, size = 20.dp, disabled = !plusEnabled) { Nav.go(Route.add(date = item)) }
    }
}

/** Big emoji + title + text placeholders */
@Composable
fun Placeholder(emoji: String, title: String?, text: String, topMargin: Dp = 12.dp, margin: Dp = 12.dp) {
    Column(Modifier.fillMaxWidth().padding(start = margin, end = margin, bottom = margin, top = topMargin), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(emoji, fontSize = 32.sp, modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 12.dp))
        if (title != null) Text(
            title, color = Colors.text.copy(alpha = 0.9f), fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
            lineHeight = 34.sp, modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 16.dp)
        )
        Text(text, color = Colors.text.copy(alpha = 0.8f), textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
    }
}

/** Full width rounded primary button (native-base Button) */
@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, color: Color = Colors.primary, enabled: Boolean = true, textStyle: TextStyle? = null, onClick: () -> Unit) {
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (enabled) color else Color.Gray)
            .clickable(enabled = enabled, onClick = onClick).padding(vertical = 14.dp, horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Color.White, style = textStyle ?: TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium), textAlign = TextAlign.Center) }
}

fun Modifier.ifTrue(condition: Boolean, block: Modifier.() -> Modifier) = if (condition) block() else this

/** SegmentedControl styled like RN's on Android (planning header, delegation header) */
@Composable
fun SegmentedControl(options: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) {
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Colors.segmentBackground).padding(2.dp)) {
        options.forEachIndexed { i, label ->
            Text(
                label, fontFamily = Fonts.roundedRegular, fontSize = 14.sp, textAlign = TextAlign.Center, maxLines = 1,
                overflow = TextOverflow.Ellipsis, color = if (i == selected) Color.White else Colors.text,
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(6.dp)).background(if (i == selected) Colors.segmentTint else Color.Transparent)
                    .clickable { onSelect(i) }.padding(vertical = 6.dp, horizontal = 2.dp),
            )
        }
    }
}
