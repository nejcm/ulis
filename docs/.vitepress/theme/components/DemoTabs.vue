<script setup>
import { ref, defineAsyncComponent } from "vue";

import CliDemo from "./CliDemo.vue";

// Async so the ~120KB frame JSON lands in its own chunk instead of every page bundle.
const TuiDemo = defineAsyncComponent(() => import("./TuiDemo.vue"));

const TABS = [
  { id: "cli", label: "cli", title: "~/projects/acme — ulis", hint: "zsh" },
  { id: "tui", label: "tui", title: "~/projects/acme — ulis tui", hint: "bun" },
];

const active = ref("cli");
const tab = () => TABS.find((t) => t.id === active.value);
</script>

<template>
  <div class="ul-demo">
    <div class="ul-demo-tabbar">
      <div class="ul-demo-tabs" role="tablist" aria-label="Demo">
        <button
          v-for="t in TABS"
          :key="t.id"
          :id="`ul-demo-tab-${t.id}`"
          class="ul-demo-tab"
          :class="{ 'ul-demo-tab-active': active === t.id }"
          role="tab"
          type="button"
          :aria-selected="active === t.id"
          :aria-controls="`ul-demo-panel-${t.id}`"
          :tabindex="active === t.id ? 0 : -1"
          @click="active = t.id"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <div class="ul-terminal">
      <div class="ul-terminal-scan"></div>
      <div class="ul-terminal-head">
        <div class="ul-tl-dots"><span></span><span></span><span></span></div>
        <span class="ul-tl-title">{{ tab().title }}</span>
        <span class="ul-tl-shell">{{ tab().hint }}</span>
      </div>
      <div :id="`ul-demo-panel-${active}`" role="tabpanel" :aria-labelledby="`ul-demo-tab-${active}`">
        <CliDemo v-if="active === 'cli'" />
        <TuiDemo v-else />
      </div>
    </div>
  </div>
</template>

<style>
.ul-terminal {
  /* 100 columns of a 0.6em-wide monospace glyph, fitted to the card */
  --ul-tui-fs: max(7.5px, calc((min(900px, 100vw - 48px) - 26px) / 61));
  /* 28 TUI rows plus padding — both demos share it so tabs never resize the card */
  --ul-demo-h: calc(28 * 1.32 * var(--ul-tui-fs) + 26px);
  position: relative;
  max-width: 900px;
  margin: 0 auto 56px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: linear-gradient(180deg, #131318, #0b0b0e);
  box-shadow:
    0 40px 110px -40px rgba(0, 0, 0, 0.95),
    0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  overflow: hidden;
}
.ul-terminal::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(53, 149, 184, 0.07), transparent 40%);
  pointer-events: none;
}
.ul-terminal-scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 60px;
  z-index: 1;
  background: linear-gradient(180deg, transparent, rgba(53, 149, 184, 0.05), transparent);
  animation: ulisScan 7s linear infinite;
  pointer-events: none;
}
@keyframes ulisScan {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(1200%);
  }
}
.ul-terminal-head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.025);
}
.ul-tl-dots {
  display: flex;
  gap: 7px;
}
.ul-tl-dots span {
  width: 11px;
  height: 11px;
  border-radius: 99px;
  background: #3a3a40;
  display: block;
}
.ul-demo-tabbar {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}
.ul-demo-tabs {
  display: flex;
  border: 1px solid var(--ul-line);
}
.ul-demo-tab {
  font-family: inherit;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  line-height: 1;
  padding: 9px 20px;
  color: var(--ul-dim);
  background: none;
  border: none;
  border-right: 1px solid var(--ul-line);
  cursor: pointer;
  transition:
    color 0.15s,
    background-color 0.15s;
}
.ul-demo-tab:last-child {
  border-right: none;
}
.ul-demo-tab:hover {
  color: #b4b2ac;
  background: rgba(255, 255, 255, 0.03);
}
.ul-demo-tab-active,
.ul-demo-tab-active:hover {
  color: var(--ul-accent);
  background: rgba(53, 149, 184, 0.1);
}
.ul-tl-title {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: var(--ul-dim);
}
.ul-tl-shell {
  font-size: 11px;
  color: var(--ul-dim);
}

@media (max-width: 640px) {
  .ul-tl-title {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ul-terminal-scan {
    animation: none;
    display: none;
  }
}
</style>
