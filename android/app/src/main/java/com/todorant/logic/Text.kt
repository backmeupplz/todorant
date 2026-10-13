package com.todorant.logic

import com.todorant.data.Settings
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

fun String.ellipsize(max: Int) = if (length > max) "${take(max)}..." else this

// region Time (time.ts)

private val dayFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd")

fun LocalDate.dateString(): String = format(dayFormat)
fun LocalDate.monthAndYear(): String = dateString().substring(0, 7)
fun LocalDate.day(): String = dateString().substring(8, 10)

/** Today, shifted back a day while it's earlier than the "start time of day" setting */
fun todayWithStartOfDay(now: LocalDateTime = LocalDateTime.now(), startTimeOfDay: String = Settings.startTimeOfDaySafe): LocalDate {
    val start = parseTime(startTimeOfDay) ?: LocalTime.MIDNIGHT
    return if (now.toLocalTime() < start) now.toLocalDate().minusDays(1) else now.toLocalDate()
}

fun todayTitle() = todayWithStartOfDay().dateString()

fun parseTime(time: String?): LocalTime? = time?.let {
    runCatching { LocalTime.of(it.substring(0, 2).toInt(), it.substring(3, 5).toInt()) }.getOrNull()
}

fun LocalTime.hhmm(): String = "%02d:%02d".format(hour, minute)

/** "YYYY-MM" or "YYYY-MM-DD" to a date (first of month for the former) */
fun parseTitle(title: String): LocalDate? = runCatching {
    if (title.length == 7) LocalDate.parse("$title-01") else LocalDate.parse(title.substring(0, 10))
}.getOrNull()

/** `new Date(getTitle(todo)).getTime()` — JS parses ISO dates as UTC midnight */
fun exactDate(title: String): Long? = parseTitle(title)?.atStartOfDay()?.toEpochSecond(ZoneOffset.UTC)?.times(1000)

/**
 * isTodoOld() from the RN app. The RN version compared day numbers as "day - 1",
 * which broke on the first day of a month; this compares real dates instead.
 */
fun isTodoOld(
    monthAndYear: String?,
    date: String?,
    now: LocalDateTime = LocalDateTime.now(),
    startTimeOfDay: String = Settings.startTimeOfDaySafe,
): Boolean {
    val currentMonth = now.toLocalDate().monthAndYear()
    if (!date.isNullOrEmpty()) {
        val day = parseTitle("$monthAndYear-$date") ?: return false
        return day < todayWithStartOfDay(now, startTimeOfDay)
    }
    return monthAndYear != null && monthAndYear <= currentMonth
}

fun isToday(monthAndYear: String?, date: String?) = "$monthAndYear-$date" == LocalDate.now().dateString()

// endregion

// region Encryption (crypto-js AES compatible: "Salted__" + EVP_BytesToKey(MD5))

object Crypto {
    fun encrypt(plain: String, password: String): String {
        val salt = ByteArray(8).also { SecureRandom().nextBytes(it) }
        val (key, iv) = evpKdf(password.toByteArray(), salt)
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        val body = cipher.doFinal(plain.toByteArray())
        return Base64.getEncoder().encodeToString("Salted__".toByteArray() + salt + body)
    }

    /** Returns null when the password is wrong or the text isn't encrypted (crypto-js returns "") */
    fun decrypt(encrypted: String, password: String): String? = runCatching {
        val bytes = Base64.getDecoder().decode(encrypted.trim())
        if (bytes.size < 16 || String(bytes, 0, 8) != "Salted__") return null
        val (key, iv) = evpKdf(password.toByteArray(), bytes.copyOfRange(8, 16))
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        String(cipher.doFinal(bytes.copyOfRange(16, bytes.size)), Charsets.UTF_8).ifEmpty { null }
    }.getOrNull()

    private fun evpKdf(password: ByteArray, salt: ByteArray): Pair<ByteArray, ByteArray> {
        val md5 = MessageDigest.getInstance("MD5")
        var derived = ByteArray(0)
        var block = ByteArray(0)
        while (derived.size < 48) {
            md5.update(block); md5.update(password); md5.update(salt)
            block = md5.digest()
            derived += block
        }
        return derived.copyOfRange(0, 32) to derived.copyOfRange(32, 48)
    }
}

// endregion

// region Linkify (linkify.ts)

sealed class TextPart {
    abstract val value: String
    data class Plain(override val value: String) : TextPart()
    data class Link(val url: String, override val value: String) : TextPart()
    /** value includes the leading '#' */
    data class Hash(override val value: String) : TextPart()
}

private const val HASH_CHARS = "\\u0400-\\u04FFa-zA-Z_0-9"
private const val TLDS = "com|org|net|io|ru|ua|me|co|dev|app|info|biz|edu|gov|uk|de|fr|it|es|br|pt|us|ca|au|in|jp|cn|tv|xyz|ai|ly|gg|so|to|fm|am|by|kz|su|рф|onion|link|site|online|store|blog|news|page|ws|cc|eu|nl|pl|ch|se|no|fi|cz|il|tr"
private val linkRegex = Regex(
    "(?<![\\w@/#])(?:(?:https?|ftp|file)://[^\\s<>\"]+|www\\.[^\\s<>\"]+|(?:[\\p{L}\\d-]+\\.)+(?:$TLDS)(?![\\p{L}\\d-])(?:[/?#][^\\s<>\"]*)?)" +
        "|(?<=^|[\\s\\p{P}&&[^#_]])#[$HASH_CHARS]+",
    RegexOption.IGNORE_CASE
)
private val trailingPunctuation = Regex("[.,;:!?)\\]}'\"]+$")

/** Splits text into plain text, links and #hashtags */
fun linkify(text: String): List<TextPart> {
    val parts = ArrayList<TextPart>()
    var end = 0
    for (m in linkRegex.findAll(text)) {
        var raw = m.value
        if (!raw.startsWith("#")) raw = raw.replace(trailingPunctuation, "")
        if (raw.isEmpty()) continue
        if (m.range.first > end) parts.add(TextPart.Plain(text.substring(end, m.range.first)))
        parts.add(if (raw.startsWith("#")) TextPart.Hash(raw) else TextPart.Link(normalizeUrl(raw), displayUrl(raw)))
        end = m.range.first + raw.length
    }
    if (end < text.length || parts.isEmpty()) parts.add(TextPart.Plain(text.substring(end)))
    return parts
}

private fun normalizeUrl(raw: String) = if (Regex("^[a-z]+://", RegexOption.IGNORE_CASE).containsMatchIn(raw)) raw else "http://$raw"

/** "host/..." when there's a path, like the RN app shows links */
private fun displayUrl(raw: String): String = runCatching {
    val uri = URI(normalizeUrl(raw))
    val host = uri.host ?: return raw
    val hasMore = (uri.rawPath ?: "").trim('/').isNotEmpty() || uri.rawFragment != null || uri.rawQuery != null
    if (hasMore) "$host/..." else host
}.getOrDefault(raw)

/** Hashtags in a text, without '#' */
fun hashtags(text: String) = linkify(text).filterIsInstance<TextPart.Hash>().map { it.value.substring(1) }

/** Q.sanitizeLikeString used for search */
fun sanitizeLike(value: String) = value.replace(Regex("[^а-яА-Яa-zA-Z0-9]"), "_")

fun capitalizeSentence(input: String) =
    Regex("(:?\\.\\s?|^)([A-Za-z\\u00C0-\\u1FFF\\u2800-\\uFFFD])").replace(input) { it.value.uppercase() }

// endregion
