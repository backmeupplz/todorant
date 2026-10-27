package com.todorant

import android.content.Context
import android.content.res.Resources
import com.todorant.data.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Same JSON translations and keys as the RN app (i18n-js with `%{var}` interpolation, falls back to English). */
object I18n {
    val languages = listOf(
        "en", "ru", "uk", "it", "es", "pt-br", "pt-pt", "de", "fr", "nl", "pl", "tr", "sv",
        "ja", "ko", "zh-hans", "zh-hant", "ar", "hi", "id", "vi", "th",
    )
    internal val strings = HashMap<String, Map<String, String>>()

    fun init(context: Context) {
        for (lang in languages) {
            val json = context.assets.open("translations/$lang.json").bufferedReader().use { JSONObject(it.readText()) }
            strings[lang] = HashMap<String, String>().also { flatten("", json, it) }
        }
        Settings.language = languageTag()
    }

    private fun flatten(prefix: String, obj: JSONObject, out: MutableMap<String, String>) {
        for (key in obj.keys()) {
            val full = if (prefix.isEmpty()) key else "$prefix.$key"
            when (val v = obj.get(key)) {
                is JSONObject -> flatten(full, v, out)
                // i18n-js reads "rules.0" from arrays
                is JSONArray -> for (i in 0 until v.length()) out["$full.$i"] = v.get(i).toString()
                else -> out[full] = v.toString()
            }
        }
    }

    /** getLanguageTag(): the user's pick, or the best match for the system language */
    fun languageTag(): String {
        Settings.languageSelect?.takeIf { it != "auto" }?.let { return it }
        for (locale in Resources.getSystem().configuration.locales.let { l -> (0 until l.size()).map { l[it] } }) {
            val tag = locale.toLanguageTag().lowercase()
            if (tag in languages) return tag
            if (locale.language in languages) return locale.language
            if (locale.language == "pt") return if (locale.country.isEmpty() || locale.country == "BR") "pt-br" else "pt-pt"
            if (locale.language == "zh") return if (locale.script == "Hant" || (locale.script.isEmpty() && locale.country in listOf("TW", "HK", "MO"))) "zh-hant" else "zh-hans"
            // Android reports Indonesian as the legacy "in"
            if (locale.language == "in") return "id"
        }
        return "en"
    }

    /** The synced language, as one of [languages] (the web stores e.g. "pt-BR") */
    fun current() = Settings.language?.lowercase() ?: "en"

    val rtl get() = current() == "ar"

    fun has(key: String) = strings[current()]?.containsKey(key) == true || strings["en"]?.containsKey(key) == true

    fun locale(): Locale = Locale.forLanguageTag(current())
}

/** translate() from the RN app. Reads Settings.language so Compose recomposes on language change. */
fun t(key: String, vararg args: Pair<String, Any?>): String {
    var s = I18n.strings[I18n.current()]?.get(key) ?: I18n.strings["en"]?.get(key) ?: key
    for ((name, value) in args) s = s.replace("%{$name}", value.toString())
    return s
}
