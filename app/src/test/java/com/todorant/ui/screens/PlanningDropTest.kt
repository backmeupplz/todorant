package com.todorant.ui.screens

import com.todorant.data.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanningDropTest {
    private fun todo(id: String, title: String, order: Double, frog: Boolean = false, frogFails: Int = 0) =
        Todo(id = id, monthAndYear = title.take(7), date = title.drop(8).ifEmpty { null }, order = order, frog = frog, frogFails = frogFails)

    private val a = "2030-01-01"
    private val b = "2030-01-02"
    private fun list() = listOf<Any>(a, todo("a1", a, 0.0), todo("a2", a, 1.0), todo("a3", a, 2.0), b, todo("b1", b, 0.0), todo("b2", b, 1.0))
    private val never: (Todo) -> Boolean = { false }

    @Test fun sameDayBetweenTwo() {
        val r = planningDrop(1, 2, list(), never) // a1 below a2: between a2 and a3
        assertEquals(1.5, r.updates.single().order, 0.0)
    }

    @Test fun sameDayToTop() {
        val r = planningDrop(3, 1, list(), never) // a3 above a1, right under the header
        assertEquals(-0.5, r.updates.single().order, 0.0)
    }

    @Test fun sameDayToBottom() {
        val r = planningDrop(1, 3, list(), never) // a1 to the end of day a (next is a header)
        assertEquals(3.0, r.updates.single().order, 0.0)
    }

    @Test fun anotherDayTopTakesThatDay() {
        val r = planningDrop(1, 4, list(), never) // a1 dropped right under header b
        val t = r.updates.single()
        assertEquals("02", t.date)
        assertEquals(-1.0, t.order, 0.0)
    }

    @Test fun anotherDayLast() {
        val l = list()
        val r = planningDrop(1, l.size - 1, l, never) // a1 to the very end
        val t = r.updates.single()
        assertEquals("02", t.date)
        assertEquals(2.0, t.order, 0.0)
    }

    @Test fun oldTodoMovedFailsAndBecomesFrog() {
        val l = list().toMutableList().apply { this[1] = todo("a1", a, 0.0, frogFails = 1) }
        val t = planningDrop(1, 5, l) { true }.updates.single()
        assertEquals(2, t.frogFails)
        assertTrue(t.frog)
    }

    @Test fun oldTodoFailedTooOftenNeedsBreakdown() {
        val l = list().toMutableList().apply { this[1] = todo("a1", a, 0.0, frogFails = 3) }
        val r = planningDrop(1, 5, l) { true }
        assertTrue(r.updates.isEmpty())
        assertEquals("a1", r.breakdown?.id)
    }

    @Test fun headerDraggedUpTakesTodosBelow() {
        val r = planningDrop(4, 2, list(), never) // header b above a2: a2, a3 move to b
        val byId = r.updates.associateBy { it.id }
        assertEquals("02", byId["a2"]?.date)
        assertEquals("02", byId["a3"]?.date)
        assertEquals(listOf(0.0, 1.0, 2.0, 3.0), listOf("a2", "a3", "b1", "b2").map { byId[it]?.order ?: -9.0 })
        assertNull(byId["a1"])
    }

    @Test fun headerDraggedDownGivesTodosAbove() {
        val l = list()
        val r = planningDrop(4, l.size - 1, l, never) // header b to the end: b1, b2 join day a
        val byId = r.updates.associateBy { it.id }
        assertEquals("01", byId["b1"]?.date)
        assertEquals(3.0, byId["b1"]!!.order, 0.0)
        assertEquals(4.0, byId["b2"]!!.order, 0.0)
    }

    @Test fun monthHeaderClearsDate() {
        val l = listOf<Any>(a, todo("a1", a, 0.0), "2030-02", todo("m1", "2030-02", 0.0))
        val t = planningDrop(1, 3, l, never).updates.single()
        assertNull(t.date)
        assertEquals("2030-02", t.monthAndYear)
    }
}
