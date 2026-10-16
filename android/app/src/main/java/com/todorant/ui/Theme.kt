package com.todorant.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.DeviceFontFamilyName
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.todorant.R
import com.todorant.data.Settings

fun hex(value: String): Color = runCatching {
    val s = value.removePrefix("#")
    val argb = when (s.length) {
        3 -> "FF" + s.map { "$it$it" }.joinToString("")
        6 -> "FF$s"
        8 -> s.substring(6) + s.substring(0, 6) // CSS #RRGGBBAA
        else -> error("bad color")
    }
    Color(argb.toLong(16))
}.getOrElse { namedColors[value.lowercase()] ?: Color(0xFF1E90FF) }

private val namedColors = mapOf(
    "dodgerblue" to Color(0xFF1E90FF), "tomato" to Color(0xFFFF6347), "grey" to Color(0xFF808080), "gray" to Color(0xFF808080),
    "darkslateblue" to Color(0xFF483D8B), "green" to Color(0xFF008000), "white" to Color.White, "black" to Color.Black,
)

fun Color.toHex(): String = "#%06X".format(0xFFFFFF and (value shr 32).toInt())

/** sharedColors from the RN app */
object Colors {
    private val dark get() = Settings.isDark
    val text get() = if (dark) Color(0xFFF9F9F9) else Color(0xFF060606)
    val invertedText get() = if (!dark) Color(0xFFF9F9F9) else Color(0xFF060606)
    val primary get() = if (dark) Color(0xFFFF641A) else Color(0xFFEB6A52)
    val background get() = if (dark) Color(0xFF19191A) else Color(0xFFFCFCFE)
    val cardBackground get() = if (dark) Color(0xFF1F1F1F) else Color.White
    val border get() = if (dark) Color(0x4DF3F3F6) else Color(0x4D000000)
    val divider get() = if (dark) Color(0x33EAEDF1) else Color(0xFFD7D8D9)
    val defaultIcon = Color(0xFF3366FF)
    val destruct = Color(0xFFE64646)
    val success = Color(0xFF4BB34B)
    val placeholder = Color(0xFF808080)
    val oldTodoBackground get() = if (dark) Color(0xFF800000) else Color(0xFFFFF0F5)
    val progressBarBackground get() = if (dark) Color(0x33F9F9F9) else Color(0x33060606)
    val link = Color(0xFF1E90FF)
    val segmentBackground get() = if (dark) Color(0xFF2F2F33) else Color(0xFFEEEEF0)
    val segmentTint get() = if (dark) Color(0xFF68686D) else Color(0xFF6E7185)

    /** color-scheme's mono/soft schemes for hues 0..345 step 15, used for hero ranks */
    val colorSchemes = listOf(
        "#cc8f8f,#805959,#e6cfcf,#bf6060", "#cc9b8f,#806159,#e6d3cf,#bf7360", "#cca78f,#806959,#e6d8cf,#bf8660",
        "#ccae8f,#806c59,#e6dacf,#bf9060", "#ccb48f,#807059,#e6dccf,#bf9960", "#ccba8f,#807459,#e6dfcf,#bfa260",
        "#ccc08f,#807859,#e6e1cf,#bfac60", "#ccc68f,#807c59,#e6e3cf,#bfb660", "#cccc8f,#808059,#e6e6cf,#bfbf60",
        "#c0cc8f,#788059,#e1e6cf,#acbf60", "#b4cc8f,#708059,#dce6cf,#99bf60", "#9bcc8f,#618059,#d3e6cf,#73bf60",
        "#72a372,#598059,#cfe6cf,#60bf60", "#648f7d,#59806f,#cfe6dc,#60bf96", "#567a7a,#598080,#cfe6e6,#60bfbf",
        "#647d8f,#596f80,#cfdce6,#6096bf", "#727ea3,#596380,#cfd4e6,#6078bf", "#6a6a8f,#5f5f80,#d2d2e6,#6d6dbf",
        "#62567a,#665980,#d6cfe6,#8060bf", "#65567a,#695980,#d8cfe6,#8860bf", "#6e567a,#735980,#decfe6,#9f60bf",
        "#7a567a,#805980,#e6cfe6,#bf60bf", "#a37297,#805976,#e6cfe0,#bf60a7", "#b88199,#80596a,#e6cfd9,#bf608a",
    ).map { s -> s.split(",").map(::hex) }

    fun forRank(rankIndex: Int) = if (rankIndex >= 0) colorSchemes[rankIndex % colorSchemes.size] else colorSchemes.last()
}

/** The system font at the weights of the RN app's SF Pro faces (Apple's fonts don't ship on Android) */
object Fonts {
    private fun system(weight: FontWeight) = FontFamily(Font(DeviceFontFamilyName("sans-serif"), weight))
    val displayBold = system(FontWeight.Bold)
    val displayMedium = system(FontWeight.Medium)
    val roundedBold = system(FontWeight.Bold)
    val roundedRegular = system(FontWeight.Normal)
    val textRegular = system(FontWeight.Normal)
    val icons = FontFamily(Font(R.font.icomoon))
}

/** Glyphs of the RN app's icomoon font */
object Icons {
    val codes = mapOf(
        "-Icon-1" to "",
        "add_outline_28" to "",
        "arrow_right_outline_28--forward" to "",
        "arrow_uturn_right_outline_28" to "",
        "calendar_outline_28--event" to "",
        "cancel_outline_28--close" to "",
        "chevron_right_outline_28" to "",
        "delete_outline_28-iOS" to "",
        "done_outline_28--check" to "",
        "edit_outline_28" to "",
        "list_outline_28" to "",
        "palette_outline_28" to "",
        "reply_outline_28-1" to "",
        "target_outline_28" to "",
    )
}

@Composable
fun TodorantTheme(content: @Composable () -> Unit) {
    val colors = if (Settings.isDark) darkColorScheme(
        primary = Colors.primary, background = Colors.background, surface = Colors.background,
        onBackground = Colors.text, onSurface = Colors.text, surfaceContainerHigh = Colors.cardBackground,
    ) else lightColorScheme(
        primary = Colors.primary, background = Colors.background, surface = Colors.background,
        onBackground = Colors.text, onSurface = Colors.text, surfaceContainerHigh = Colors.cardBackground,
    )
    MaterialTheme(colorScheme = colors, content = content)
}
