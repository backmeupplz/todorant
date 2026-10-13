package com.todorant.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateRectAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons as MaterialIcons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.todorant.I18n
import com.todorant.R
import com.todorant.data.Session
import com.todorant.sync.Rest
import com.todorant.t
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/** Confetti, "mission passed" overlay and the rate dialog, drawn above everything */
@Composable
fun EffectsLayer() {
    Confetti()
    DayCompleteOverlay()
    RateModal()
}

// region Confetti (react-native-confetti: 25 pieces, 20ms apart, 2s fall)

private val confettiColors = listOf(Color(242, 102, 69), Color(255, 199, 92), Color(122, 199, 163), Color(77, 194, 217), Color(148, 99, 140))

private class Piece(val x: Float, val delay: Float, val color: Color, val size: Float, val spin: Float, val wobble: Float)

@Composable
private fun Confetti() {
    val key = Effects.confettiKey
    val initial = remember { key }
    val progress = remember { Animatable(1f) }
    val pieces = remember(key) {
        List(25) { i -> Piece(Random.nextFloat(), i * 20f, confettiColors.random(), 6f + Random.nextFloat() * 6f, Random.nextFloat() * 720f, Random.nextFloat() * 6f) }
    }
    LaunchedEffect(key) {
        if (key == initial) return@LaunchedEffect
        progress.snapTo(0f)
        progress.animateTo(1f, tween(2500, easing = LinearEasing))
    }
    if (progress.value >= 1f) return
    val density = LocalDensity.current.density
    Canvas(Modifier.fillMaxSize()) {
        val time = progress.value * 2500f
        for (p in pieces) {
            val local = (time - p.delay) / 2000f
            if (local !in 0f..1f) continue
            val s = p.size * density
            val x = p.x * size.width + sin(local * p.wobble * 3.14f) * 20f * density
            val y = -s + local * (size.height + 2 * s)
            rotate(p.spin * local, Offset(x, y)) {
                drawRect(p.color, Offset(x - s / 2, y - s / 4), Size(s, s / 2))
            }
        }
    }
}

// endregion

@Composable
private fun DayCompleteOverlay() {
    val key = Effects.dayCompleteKey
    val initial = remember { key }
    val alpha = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(key) {
        // Ignored while already showing, like the RN overlay
        if (key == initial || alpha.isRunning) return@LaunchedEffect
        scope.launch {
            alpha.animateTo(1f, tween(9000, easing = LinearEasing))
            alpha.animateTo(0f, tween(1000, easing = LinearEasing))
        }
    }
    if (alpha.value == 0f) return
    Column(
        Modifier.fillMaxSize().alpha(alpha.value).background(Color.Black.copy(alpha = 0.7f)),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(t("missionPassed"), color = Color(153, 126, 40), fontSize = 40.sp, lineHeight = 46.sp, textAlign = TextAlign.Center)
        Text(t("respect"), color = Color.White, fontSize = 40.sp, lineHeight = 46.sp, textAlign = TextAlign.Center)
    }
}

/** Asks for a store rating after 100 completed todos; low ratings go to feedback instead */
@Composable
private fun RateModal() {
    var closed by remember { mutableStateOf(false) }
    if (!Session.needsToRequestRate || closed) return
    var rating by remember { mutableIntStateOf(0) }
    var comment by remember { mutableStateOf("") }
    var showComment by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    fun close() {
        closed = true
        Session.askedToRate = true
    }
    val labels = listOf("starTerrible", "starBad", "starOkay", "starGood", "starGreat")
    Dialog(onDismissRequest = ::close) {
        Column(Modifier.clip(RoundedCornerShape(16.dp)).background(Colors.background).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(t("rateTitle"), color = Colors.text, fontSize = 18.sp, textAlign = TextAlign.Center)
            Row(Modifier.padding(vertical = 12.dp)) {
                for (i in 1..5) MIcon(
                    if (i <= rating) MaterialIcons.Filled.Star else MaterialIcons.Filled.StarBorder, Colors.primary, 40.dp,
                    Modifier.padding(horizontal = 2.dp),
                ) { rating = i }
            }
            if (rating > 0) Text(t(labels[rating - 1]), color = Colors.text)
            if (showComment) {
                OutlinedTextField(
                    comment, { comment = it; error = false }, Modifier.fillMaxWidth().padding(top = 12.dp),
                    placeholder = { Text(t("rateCommentPlaceholder"), color = Colors.placeholder) }, minLines = 3,
                    colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Colors.text, unfocusedTextColor = Colors.text, focusedBorderColor = Colors.primary),
                )
                if (error) Text(t("rateCommentEmptyError"), color = Color(0xFFFF6347), modifier = Modifier.padding(top = 4.dp))
            }
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(
                    Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).border(BorderStroke(1.dp, Colors.text), RoundedCornerShape(10.dp))
                        .clickable(onClick = ::close).padding(12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(t("cancel"), color = Colors.text) }
                Box(
                    Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(if (rating > 0) Colors.primary else Color.Gray)
                        .clickable(enabled = rating > 0) {
                            when {
                                rating >= 4 -> {
                                    closed = true
                                    Ui.alert(
                                        "", t("rateSolicitationGoogle"),
                                        listOf(
                                            t("cancel") to { Session.askedToRate = true },
                                            t("rateButton") to {
                                                Ui.openUrl("market://details?id=com.todorant")
                                                Session.askedToRate = true
                                            },
                                        ),
                                    )
                                }
                                !showComment -> showComment = true
                                comment.isBlank() -> error = true
                                else -> {
                                    close()
                                    if (Session.user != null) Ui.launch {
                                        runCatching { Rest.sendFeedback(JSONObject().put("rating", rating).put("review", comment)) }
                                    }
                                }
                            }
                        }.padding(12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(t(if (showComment) "send" else "rate"), color = Colors.background) }
            }
        }
    }
}

// region Onboarding overlay (Overlay.tsx, MessageBox.tsx, OnboardingButton.tsx)

/** buildRnHole: grows the target bounds by 1/divider (height × heightMultiplier) */
private fun buildHole(r: Rect, step: Step): Rect {
    val halfH = r.height / step.divider * step.heightMultiplier
    val halfW = r.width / step.divider
    return Rect(r.left - halfW / 2, r.top - halfH / 2, r.right + halfW / 2, r.bottom + halfH / 2)
}

/** Consumes every touch inside l,t,r,b (px) */
@Composable
private fun block(l: Float, t: Float, r: Float, b: Float) {
    val density = LocalDensity.current
    Box(
        Modifier.offset { IntOffset(l.roundToInt(), t.roundToInt()) }
            .size(with(density) { (r - l).coerceAtLeast(0f).toDp() }, with(density) { (b - t).coerceAtLeast(0f).toDp() })
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent().changes.forEach { it.consume() } } }
    )
}

/** The tutorial overlay: dims everything but a hole around the current target; touches only reach the app through the hole */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingOverlay() {
    LaunchedEffect(Unit) { Onboarding.restore() }
    val visible = Onboarding.active
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(500), label = "onboarding")
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) {
        if (imeVisible && visible && Onboarding.step == TutorialStep.AddText) Onboarding.nextStep(TutorialStep.AddTextContinueButton)
    }
    if (!visible && alpha == 0f) return
    val keyboard = LocalSoftwareKeyboardController.current
    BoxWithConstraints(Modifier.fillMaxSize().alpha(alpha)) {
        val density = LocalDensity.current
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        val step = Onboarding.stepObject
        val targetRect = step.target?.let { Onboarding.targets[it] }
        val hole by animateRectAsState(
            targetRect?.let { buildHole(it, step) } ?: Rect(Offset(width / 2, height / 2), Size.Zero), tween(500), label = "hole"
        )
        val radius = min(with(density) { step.borderRadius.dp.toPx() }, min(hole.width, hole.height) / 2)
        Canvas(Modifier.fillMaxSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            drawRect(Color.Black.copy(alpha = 0.7f))
            drawRoundRect(Color.Black, hole.topLeft, hole.size, CornerRadius(radius), blendMode = BlendMode.Clear)
        }
        if (visible) {
            // Four blockers around the hole so touches inside it reach the screen below
            val top = hole.top.coerceIn(0f, height)
            val bottom = hole.bottom.coerceIn(top, height)
            block(0f, 0f, width, top)
            block(0f, bottom, width, height)
            block(0f, top, hole.left.coerceIn(0f, width), bottom)
            block(hole.right.coerceIn(0f, width), top, width, bottom)
        }

        var boxHeight by remember { mutableIntStateOf(0) }
        val padding = with(density) { 16.dp.toPx() }
        val y = when {
            step.center || targetRect == null -> (height - boxHeight) / 2
            hole.center.y > height / 2 -> hole.top - padding - boxHeight
            else -> hole.bottom + padding
        }.coerceIn(0f, (height - boxHeight).coerceAtLeast(0f))
        val animatedY by animateFloatAsState(y, tween(500), label = "messageBox")
        Box(
            Modifier.offset { IntOffset(0, animatedY.roundToInt()) }.fillMaxWidth().onSizeChanged { boxHeight = it.height }.padding(12.dp),
            contentAlignment = Alignment.TopCenter,
        ) {
            MessageBox(step) { action -> keyboard?.hide(); action() }
        }

        if (visible && !step.notShowClose) {
            val atBottom = Onboarding.step == TutorialStep.AddAnotherTask || Onboarding.step == TutorialStep.ExplainSearchAndCompleted
            Icon(
                MaterialIcons.Filled.Close, null, tint = Color.White,
                modifier = Modifier.align(if (atBottom) Alignment.BottomEnd else Alignment.TopEnd)
                    .let { if (atBottom) it.navigationBarsPadding() else it.statusBarsPadding() }
                    .padding(12.dp).size(48.dp).clip(CircleShape)
                    .clickable { keyboard?.hide(); Onboarding.nextStep(TutorialStep.Close) }
            )
        }
    }
}

@Composable
private fun MessageBox(step: Step, run: (() -> Unit) -> Unit) {
    val stepKey = Onboarding.step.key
    Column(Modifier.widthIn(max = 400.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        AnimatedVisibility(Onboarding.step == TutorialStep.Start || Onboarding.step == TutorialStep.Explain, enter = fadeIn(tween(500)), exit = fadeOut(tween(500))) {
            Image(
                painterResource(R.drawable.nikita), null, contentScale = ContentScale.Crop,
                modifier = Modifier.padding(12.dp).size(104.dp).clip(CircleShape).border(2.dp, Colors.background, CircleShape)
            )
        }
        if (!step.notShowMessage) {
            Crossfade(stepKey, Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Colors.background).padding(18.dp), label = "message") { key ->
                val bodyKey = "onboarding.$key.messageBoxBody"
                Text(if (I18n.has(bodyKey)) t(bodyKey) else "", color = Colors.text)
            }
        }
        if (!step.notShowContinue) {
            val text = if (step.customContinueText) t("onboarding.$stepKey.nextStepButton") else t("onboarding.defaultNextStepButtonText")
            OnboardingButtonView(text, preferred = true) { run { Onboarding.nextStep() } }
        }
        for (button in step.buttons) {
            val text = if (button.notAllowed) t("onboarding.notAllowed") else t("onboarding.$stepKey.${button.message}")
            OnboardingButtonView(text, button.preferred) { run(button.action) }
        }
    }
}

private val preferredGradient = Brush.linearGradient(listOf(Color(0xFF1148B9), Color(0xFF3581FC)))

@Composable
private fun OnboardingButtonView(title: String, preferred: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.padding(top = 12.dp).fillMaxWidth().alpha(if (preferred) 1f else 0.7f).clip(RoundedCornerShape(28.dp))
            .let { if (preferred) it.background(preferredGradient) else it.background(Color.White) }
            .clickable(onClick = onClick).padding(18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, color = if (preferred) Color.White else Color.Black, textAlign = TextAlign.Center)
    }
}

// endregion
