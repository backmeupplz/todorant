package com.todorant.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Test

class AddTodoApplyTagTest {
    @Test fun applyTag() {
        assertEquals("buy milk #home " to 15, applyTagText("buy milk", 8, "home"))
        assertEquals("buy #home " to 10, applyTagText("buy #ho", 7, "home"))
        assertEquals("buy #home " to 10, applyTagText("buy #", 5, "home"))
        assertEquals("#x " to 3, applyTagText("", 0, "x"))
        assertEquals("a #x b" to 5, applyTagText("a b", 1, "x"))
    }
}
