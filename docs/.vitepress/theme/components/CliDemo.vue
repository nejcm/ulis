<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from "vue";

import { version } from "../../../../package.json";

const SCRIPT = [
  { kind: "cmd", text: "bun add -g @nejcm/ulis" },
  { kind: "dim", text: `installed @nejcm/ulis@${version}` },
  { kind: "cmd", text: "ulis init" },
  { kind: "ok", text: "scaffolded .ulis/ — agents, skills, commands, raw, rules, config.yaml, mcp.yaml, …" },
  { kind: "cmd", text: "ulis build" },
  { kind: "ok", text: "opencode      → generated/opencode/" },
  { kind: "ok", text: "claude        → generated/claude/" },
  { kind: "ok", text: "codex         → generated/codex/" },
  { kind: "ok", text: "cursor        → generated/cursor/" },
  { kind: "ok", text: "forgecode     → generated/forgecode/" },
  { kind: "dim", text: "validation passed · 0 warning(s)" },
  { kind: "cmd", text: "ulis install --yes" },
  { kind: "ok", text: "installed into every tool. one source of truth." },
];
const MARKS = { cmd: "$", ok: "✓", dim: " " };

const lines = ref([]);
const typing = ref("");
const termEl = ref(null);
let alive = true;
let timer;

function wait(ms) {
  return new Promise((r) => {
    timer = setTimeout(r, ms);
  });
}

async function run(i) {
  if (!alive) return;
  if (i >= SCRIPT.length) {
    await wait(2600);
    if (!alive) return;
    lines.value = [];
    typing.value = "";
    await wait(500);
    return run(0);
  }
  const step = SCRIPT[i];
  if (step.kind === "cmd") {
    for (let c = 1; c <= step.text.length; c++) {
      if (!alive) return;
      typing.value = step.text.slice(0, c);
      await wait(34 + Math.random() * 26);
    }
    await wait(320);
    if (!alive) return;
    lines.value = [...lines.value, { kind: step.kind, mark: MARKS[step.kind], text: step.text }];
    typing.value = "";
    await wait(420);
  } else {
    lines.value = [...lines.value, { kind: step.kind, mark: MARKS[step.kind], text: step.text }];
    await wait(step.kind === "dim" ? 520 : 170);
  }
  return run(i + 1);
}

watch(lines, () => {
  nextTick(() => {
    if (termEl.value) termEl.value.scrollTop = termEl.value.scrollHeight;
  });
});

onMounted(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Show the finished transcript instead of typing it out.
    lines.value = SCRIPT.map((s) => ({ kind: s.kind, mark: MARKS[s.kind], text: s.text }));
    return;
  }
  run(0);
});
onUnmounted(() => {
  alive = false;
  clearTimeout(timer);
});
</script>

<template>
  <div ref="termEl" class="ul-terminal-body">
    <div v-for="(line, i) in lines" :key="i" class="ul-line" :class="'ul-line-' + line.kind">
      <span class="ul-mark">{{ line.mark }}</span>
      <span class="ul-text">{{ line.text }}</span>
    </div>
    <div class="ul-line">
      <span class="ul-mark ul-mark-cmd">$</span>
      <span class="ul-text">{{ typing }}<span class="ul-caret"></span></span>
    </div>
  </div>
</template>

<style>
.ul-terminal-body {
  position: relative;
  padding: 24px 32px 34px;
  font-size: 14px;
  line-height: 1.9;
  height: var(--ul-demo-h);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
}
.ul-line {
  display: flex;
  gap: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.ul-mark {
  color: transparent;
}
.ul-line-cmd .ul-mark,
.ul-line-ok .ul-mark,
.ul-mark-cmd {
  color: var(--ul-accent);
}
.ul-line-cmd .ul-text {
  color: var(--ul-fg);
}
.ul-line-ok .ul-text {
  color: #b4b2ac;
}
.ul-line-dim .ul-text {
  color: var(--ul-dim);
}
.ul-caret {
  display: inline-block;
  width: 8px;
  height: 15px;
  margin-left: 1px;
  transform: translateY(2px);
  background: var(--ul-accent);
  animation: ulisBlink 1s steps(1) infinite;
}
@keyframes ulisBlink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

@media (max-width: 640px) {
  .ul-terminal-body {
    padding: 18px 16px 22px;
    font-size: 12px;
  }
}
</style>
