package com.todorant

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Every language in the picker has a complete translation with the same %{placeholders} as English (iOS reads the same files) */
class TranslationsTest {
    private val dir = File("src/main/assets/translations")

    private fun flatten(prefix: String, value: Any, out: MutableMap<String, String>) {
        when (value) {
            is JSONObject -> for (key in value.keys()) flatten(if (prefix.isEmpty()) key else "$prefix.$key", value.get(key), out)
            is JSONArray -> for (i in 0 until value.length()) flatten("$prefix.$i", value.get(i), out)
            else -> out[prefix] = value.toString()
        }
    }

    private fun load(lang: String) = HashMap<String, String>().also { flatten("", JSONObject(File(dir, "$lang.json").readText()), it) }

    private fun placeholders(s: String) = Regex("%\\{\\w+\\}").findAll(s).map { it.value }.sorted().toList()

    @Test
    fun everyLanguageIsComplete() {
        val en = load("en")
        assertEquals(I18n.languages.map { "$it.json" }.toSet(), dir.list()!!.toSet())
        for (lang in I18n.languages - "en") {
            val strings = load(lang)
            assertEquals("$lang keys", en.keys, strings.keys)
            for ((key, english) in en) {
                val translated = strings.getValue(key)
                assertEquals("$lang $key placeholders", placeholders(english), placeholders(translated))
                assertTrue("$lang $key is empty", english.isBlank() || translated.isNotBlank())
            }
        }
    }

    /** A double-escaped line break ("\\n" in the JSON) shows up on screen as a literal backslash-n */
    @Test
    fun noLiteralLineBreaks() {
        for (lang in I18n.languages) for ((key, value) in load(lang)) assertTrue("$lang $key has a literal \\n", "\\n" !in value)
    }
}
