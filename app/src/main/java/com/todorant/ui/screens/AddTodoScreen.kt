package com.todorant.ui.screens

import androidx.compose.runtime.Composable

enum class AddMode { add, edit, breakdown }

/** AddTodo / EditTodo / BreakdownTodo. [todoId] is the edited or broken down todo. */
@Composable
fun AddTodoScreen(mode: AddMode, todoId: String?, date: String?, text: String?) {}
