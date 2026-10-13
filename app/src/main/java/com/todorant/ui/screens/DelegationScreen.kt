package com.todorant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.todorant.data.AppState
import com.todorant.data.Db
import com.todorant.data.DelegateSection
import com.todorant.data.Session
import com.todorant.data.Todo
import com.todorant.logic.Todos
import com.todorant.t
import com.todorant.ui.CardType
import com.todorant.ui.Colors
import com.todorant.ui.Fonts
import com.todorant.ui.InfoButton
import com.todorant.ui.Placeholder
import com.todorant.ui.TodoCard
import com.todorant.ui.SegmentedControl
import com.todorant.ui.TodoHeader
import com.todorant.ui.dbState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DelegationScreen() {
    Column(Modifier.fillMaxSize().background(Colors.background)) {
        Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.statusBars).height(56.dp), contentAlignment = Alignment.Center) {
            val sections = listOf(DelegateSection.ToMe to "delegate.ToMe", DelegateSection.ByMe to "delegate.ByMe", DelegateSection.Completed to "completed")
            SegmentedControl(sections.map { t(it.second) }, sections.indexOfFirst { it.first == AppState.delegateSection }, Modifier.fillMaxWidth(0.7f)) {
                AppState.delegateSection = sections[it].first
            }
            InfoButton("delegate.info", Modifier.align(Alignment.CenterEnd))
        }
        if (Session.user == null) Placeholder("🐶", t("delegate.signupTitle"), t("delegate.signupDescription"), topMargin = 30.dp)
        else DelegationList(AppState.delegateSection)
    }
}

@Composable
private fun DelegationList(section: DelegateSection) {
    val byMe = section != DelegateSection.ToMe
    val groups = dbState(section, Session.user?.id, initial = emptyList<Pair<String, List<Todo>>>()) {
        // Counterpart: the delegate for todos I delegated, the delegator for todos delegated to me
        val names = (if (byMe) Db.delegates() else Db.delegators()).mapNotNull { u -> u.serverId?.let { it to (u.name ?: "") } }.toMap()
        Todos.delegated(byMe, section == DelegateSection.Completed)
            .groupBy { if (byMe) it.userId else it.delegatorId }
            .mapNotNull { (id, todos) -> names[id]?.let { it to todos } }
    }
    if (groups.isEmpty()) {
        Placeholder(
            "🏅", null, t(if (section == DelegateSection.ToMe) "delegate.noDelegatedTasks" else "delegate.noDelegatedTasksTo"), topMargin = 30.dp,
        )
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        for ((name, todos) in groups) {
            if (name.isNotEmpty()) item("header-$name-${todos.first().id}") { TodoHeader(name, hidePlus = true) }
            items(todos, key = { it.id }) { TodoCard(it, CardType.delegation) }
        }
        item { Box(Modifier.padding(bottom = 24.dp)) }
    }
}
