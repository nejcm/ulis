<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";

import data from "../tui-frames.json";

// Frames are delta-encoded: a `0` row means "same as the previous frame".
const RESOLVED = (() => {
  const out = [];
  let previous = [];
  for (const frame of data.frames) {
    const lines = frame.lines.map((line, row) => (line === 0 ? previous[row] : line));
    previous = lines;
    out.push({ hold: frame.hold, lines });
  }
  return out;
})();

const index = ref(0);
const frame = computed(() => RESOLVED[index.value]);

let timer;
function advance() {
  timer = setTimeout(() => {
    index.value = (index.value + 1) % RESOLVED.length;
    advance();
  }, RESOLVED[index.value].hold);
}

onMounted(advance);
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="ul-tui-body">
    <pre class="ul-tui-screen" aria-label="ulis TUI walkthrough"><span
      v-for="(line, row) in frame.lines"
      :key="row"
      class="ul-tui-row"
    ><span
      v-for="(span, i) in line"
      :key="i"
      :style="{ color: span[1] || undefined, background: span[3] || undefined, fontWeight: span[2] ? 700 : undefined }"
    >{{ span[0] }}</span></span></pre>
  </div>
</template>

<style>
.ul-tui-body {
  padding: 12px 12px 14px;
  background: #0d1117;
  height: var(--ul-demo-h);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden auto;
}
.ul-tui-screen {
  margin: 0;
  padding: 0;
  background: none;
  border: none;
  font-family: "JetBrains Mono", var(--vp-font-family-mono);
  font-size: var(--ul-tui-fs);
  line-height: 1.32;
  color: #c9d1d9;
  white-space: pre;
  overflow: hidden;
}
.ul-tui-row {
  display: block;
}

@media (max-width: 640px) {
  .ul-tui-body {
    padding: 8px;
  }
}
</style>
