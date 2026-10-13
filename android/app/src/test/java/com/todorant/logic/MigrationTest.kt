package com.todorant.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File

class MigrationTest {
    private fun ByteArrayOutputStream.varint(v: Int) {
        var x = v
        while (x >= 0x80) { write((x and 0x7f) or 0x80); x = x ushr 7 }
        write(x)
    }

    private fun ByteArrayOutputStream.entry(key: String, value: String) {
        val k = key.toByteArray(); val v = value.toByteArray()
        varint(k.size); write(k)
        val inner = ByteArrayOutputStream().apply { varint(v.size); write(v) }.toByteArray()
        varint(inner.size); write(inner)
    }

    @Test
    fun readsLastValueOfEachStore() {
        val log = ByteArrayOutputStream().apply {
            write(byteArrayOf(0, 0, 0, 0))
            entry("SettingsStore", """{"soundOn":true}""")
            entry("HeroStore", """{"points":42}""")
            // MMKV appends updates; the last one wins
            entry("SettingsStore", """{"soundOn":false,"planningReminderTime":"09:30","x":"${"y".repeat(200)}"}""")
            entry("languageSelect", "ru")
        }
        val file = File.createTempFile("mmkv", null).apply { writeBytes(log.toByteArray()); deleteOnExit() }
        val stores = Migration.readMmkv(file)
        assertEquals(false, stores["SettingsStore"]!!.getBoolean("soundOn"))
        assertEquals("09:30", stores["SettingsStore"]!!.getString("planningReminderTime"))
        assertEquals(42, stores["HeroStore"]!!.getInt("points"))
        assertEquals("ru", stores["languageSelect"]!!.getString("value"))
        assertTrue("SessionStore" !in stores)
    }
}
