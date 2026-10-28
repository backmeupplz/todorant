package com.todorant.logic

import com.todorant.data.Ids
import com.todorant.data.Todo
import com.todorant.sync.serverUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class LogicTest {
    @Test
    fun cryptoJsCompatible() {
        // Produced by crypto-js 4.1.1: AES.encrypt('Купить молоко #shop 🐸', 'pa$$word').toString()
        val fromCryptoJs = "U2FsdGVkX19Iq7lrISRqAVJxTEsszMteq76/yk4B32bM7BHCgY4sbGPyzrwO6rIlCvd1NRGzddXxmv6HIvpUkg=="
        assertEquals("Купить молоко #shop 🐸", Crypto.decrypt(fromCryptoJs, "pa\$\$word"))
        assertNull(Crypto.decrypt(fromCryptoJs, "wrong"))
        assertNull(Crypto.decrypt("plain text", "pa\$\$word"))
        assertEquals("round trip", Crypto.decrypt(Crypto.encrypt("round trip", "k"), "k"))
    }

    @Test
    fun linkifySplitsLinksAndHashtags() {
        val parts = linkify("Buy #milk at https://shop.com/item?id=1 and see example.org, ok #дом_2")
        assertEquals(
            listOf(
                TextPart.Plain("Buy "), TextPart.Hash("#milk"), TextPart.Plain(" at "),
                TextPart.Link("https://shop.com/item?id=1", "shop.com/..."), TextPart.Plain(" and see "),
                TextPart.Link("http://example.org", "example.org"), TextPart.Plain(", ok "), TextPart.Hash("#дом_2"),
            ),
            parts,
        )
        assertEquals(listOf("milk", "дом_2"), hashtags("Buy #milk at https://x.com/#anchor and #дом_2"))
        // Not a hashtag in the middle of a word
        assertEquals(emptyList<String>(), hashtags("issue a#b"))
    }

    @Test
    fun isolatesHashtagsForRightToLeft() {
        assertEquals("⁨#work⁩", isolate("#work"))
        // Links stay as typed, a#b is no tag
        assertEquals("اشتر ⁨#work⁩ https://x.com/#a a#b ⁨#дом⁩", isolateHashtags("اشتر #work https://x.com/#a a#b #дом"))
        assertEquals("no tags", isolateHashtags("no tags"))
        assertEquals("", isolateHashtags(""))

        val shown = isolateHashtagsMapped("اشتر #work الآن")
        assertEquals("اشتر ⁨#work⁩ الآن", shown.text)
        // The cursor before a tag stays outside it, the one after its last letter inside
        assertEquals(5, shown.toShown[5])
        assertEquals(11, shown.toShown[10])
        assertEquals(13, shown.toShown[11])
        assertEquals(listOf(5, 5, 10, 10), listOf(5, 6, 11, 12).map { shown.toOriginal[it] })
        for (text in listOf("اشتر #work الآن", "#a #b", "a #x", "#", "plain", "")) {
            val mapped = isolateHashtagsMapped(text)
            assertEquals(text.length + 1, mapped.toShown.size)
            assertEquals(mapped.text.length + 1, mapped.toOriginal.size)
            for (i in 0..text.length) assertEquals(i, mapped.toOriginal[mapped.toShown[i]])
            assertTrue(mapped.toOriginal.all { it in 0..text.length })
            assertEquals(text, mapped.text.replace("⁨", "").replace("⁩", ""))
        }
    }

    @Test
    fun dates() {
        assertEquals(LocalDate.of(2026, 10, 12), todayWithStartOfDay(LocalDateTime.of(2026, 10, 13, 3, 0), "04:00"))
        assertEquals(LocalDate.of(2026, 10, 13), todayWithStartOfDay(LocalDateTime.of(2026, 10, 13, 5, 0), "04:00"))
        assertEquals(1791849600000L, exactDate("2026-10-13"))
        assertEquals(exactDate("2026-10-01"), exactDate("2026-10"))
        assertNull(exactDate(""))
    }

    @Test
    fun oldTodos() {
        val firstOfMonth = LocalDateTime.of(2026, 11, 1, 12, 0)
        // The RN version missed this one: yesterday is in the previous month
        assertTrue(isTodoOld("2026-10", "31", firstOfMonth, "00:00"))
        assertFalse(isTodoOld("2026-11", "01", firstOfMonth, "00:00"))
        // Before the start of day "today" is still yesterday
        assertFalse(isTodoOld("2026-10", "31", LocalDateTime.of(2026, 11, 1, 2, 0), "04:00"))
        assertTrue(isTodoOld("2026-11", null, firstOfMonth, "00:00"))
        assertFalse(isTodoOld("2026-12", null, firstOfMonth, "00:00"))
    }

    @Test
    fun fixOrderHelpers() {
        fun todo(id: String, order: Double, time: String? = null) = Todo(id = id, order = order, time = time)
        val sorted = Todos.sortForFix(listOf(todo("a", 0.0), todo("new", 0.0), todo("b", 1.0)), onTop = setOf("new"), onBottom = emptySet())
        assertEquals(listOf("new", "a", "b"), sorted.map { it.id })

        val timed = mutableListOf(todo("x", 0.0, "10:00"), todo("y", 1.0), todo("z", 2.0, "09:00"))
        assertFalse(Todos.isTimeSorted(timed))
        while (!Todos.isTimeSorted(timed)) Todos.fixOneTodoTime(timed, setOf("z"))
        assertEquals(listOf("z", "x", "y"), timed.map { it.id })
    }

    @Test
    fun serverUrls() {
        assertEquals("https://todo.example.com", serverUrl(" todo.example.com/ "))
        assertEquals("http://192.168.1.5:1337", serverUrl("http://192.168.1.5:1337"))
        assertEquals("https://example.com/todorant", serverUrl("HTTPS://Example.com:443/todorant/"))
        assertNull(serverUrl("ftp://example.com"))
        assertNull(serverUrl("https://example.com/?a=1"))
        assertNull(serverUrl("https://"))
    }

    @Test
    fun idsHaveFreshRandomBytes() {
        val (a, b) = Ids.new() to Ids.new()
        assertTrue(Regex("[0-9a-f]{24}").matches(a))
        // Bytes 4..8 are random for every id, not once per process
        assertNotEquals(a.substring(8, 18), b.substring(8, 18))
    }
}
