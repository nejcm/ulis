---
layout: home
markdownStyles: false
pageClass: ulis-landing-page
---

<div class="ulis-landing">

  <section class="ul-hero">
    <div data-reveal class="ul-badge">v0.0.30 · ISC</div>
    <h1 data-reveal data-delay="90">One config source to <span class="ul-accent">rule them all</span>.</h1>
    <p data-reveal data-delay="170" class="ul-sub">Five AI coding tools. Five bespoke dotfile formats. One neutral model in <span class="ul-hl">.ulis/</span> that compiles into all of them.</p>
    <div data-reveal data-delay="250" class="ul-cta-row">
      <a href="/ulis/guide/getting-started.html" class="ul-btn ul-btn-primary">Get started</a>
      <a href="/ulis/CLI.html" class="ul-btn ul-btn-ghost">CLI reference</a>
    </div>
    <div data-reveal data-delay="330" class="ul-targets">
      <div class="ul-target" v-for="t in targets" :key="t.name"><span class="ul-dot"></span><span class="ul-target-name">{{ t.name }}</span>{{ t.path }}</div>
    </div>
  </section>

  <section data-reveal data-delay="420" class="ul-terminal-wrapper">
    <div class="ul-terminal">
        <div class="ul-terminal-scan"></div>
        <div class="ul-terminal-head">
        <div class="ul-tl-dots"><span></span><span></span><span></span></div>
        <span class="ul-tl-title">~/projects/acme — ulis</span>
        <span class="ul-tl-shell">zsh</span>
        </div>
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
    </div>
  </section>

  <section class="ul-pipeline">
    <div data-reveal class="ul-eyebrow">pipeline</div>
    <div data-reveal data-delay="80" class="ul-pipe-grid">
      <div class="ul-pipe-step" v-for="s in steps" :key="s.cmd">
        <div class="ul-pipe-cmd">{{ s.cmd }}</div>
        <div class="ul-pipe-title">{{ s.title }}</div>
        <div class="ul-pipe-body">{{ s.body }}</div>
      </div>
    </div>
  </section>

  <section class="ul-tree-wrap">
    <div class="ul-tree-grid">
      <div data-reveal class="ul-tree">
        <div class="ul-eyebrow">.ulis/</div>
        <div class="ul-tree-body">
          <div class="ul-accent">.ulis/</div>
          <div>├── agents/<span class="ul-dim">        reviewer.md · planner.md</span></div>
          <div>├── skills/<span class="ul-dim">        release.md · triage.md</span></div>
          <div>├── mcp/<span class="ul-dim">           github.yaml · fs.yaml</span></div>
          <div>├── permissions.yaml</div>
          <div>└── ulis.yaml</div>
        </div>
      </div>
      <div data-reveal data-delay="120" class="ul-tree ul-tree-right">
        <div class="ul-eyebrow">generated/</div>
        <div class="ul-tree-body">
          <div>├── .claude/<span class="ul-dim">       agents · skills · settings.json</span></div>
          <div>├── .codex/<span class="ul-dim">        config.toml · prompts</span></div>
          <div>├── .cursor/<span class="ul-dim">       rules · mcp.json</span></div>
          <div>├── .opencode/<span class="ul-dim">     opencode.json</span></div>
          <div>└── .forge/<span class="ul-dim">        forge.yaml</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="ul-cta-wrap">
    <div class="ul-cta-box">
      <h2 data-reveal>Kill the config drift in 60 seconds.</h2>
      <code data-reveal data-delay="90"><span class="ul-accent">$ </span>bun add -g @nejcm/ulis &amp;&amp; ulis init</code>
      <a data-reveal data-delay="170" href="/ulis/guide/getting-started.html" class="ul-btn ul-btn-primary">Read the guide</a>
    </div>
  </section>

</div>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'

const SCRIPT = [
  { kind: 'cmd', text: 'bun add -g @nejcm/ulis' },
  { kind: 'dim', text: 'installed @nejcm/ulis@0.0.30 · 12 packages · 840ms' },
  { kind: 'cmd', text: 'ulis init' },
  { kind: 'ok', text: 'scaffolded .ulis/ — agents, skills, mcp, permissions.yaml' },
  { kind: 'cmd', text: 'ulis build' },
  { kind: 'ok', text: 'claude-code   → generated/.claude/' },
  { kind: 'ok', text: 'codex         → generated/.codex/' },
  { kind: 'ok', text: 'cursor        → generated/.cursor/' },
  { kind: 'ok', text: 'opencode      → generated/.opencode/' },
  { kind: 'ok', text: 'forgecode     → generated/.forge/' },
  { kind: 'dim', text: '5 targets · 24 files · 0 collisions · schema valid' },
  { kind: 'cmd', text: 'ulis install --yes' },
  { kind: 'ok', text: 'installed into every tool. one source of truth.' },
]
const MARKS = { cmd: '$', ok: '✓', dim: ' ' }

const targets = [
  { name: 'Claude Code', path: '.claude/' },
  { name: 'Codex', path: '.codex/' },
  { name: 'Cursor', path: '.cursor/rules' },
  { name: 'OpenCode', path: '.opencode/' },
  { name: 'ForgeCode', path: '.forge/' },
]
const steps = [
  { cmd: 'ulis init', title: 'Scaffold', body: 'Creates the canonical .ulis/ tree with sane defaults for agents, skills, MCP and permissions.' },
  { cmd: 'ulis check', title: 'Validate', body: 'Schema parse, collision detection and reference resolution — fails fast before anything is written.' },
  { cmd: 'ulis build', title: 'Compile', body: 'Emits native config for every target into /generated/ so you can diff before you ship.' },
  { cmd: 'ulis install', title: 'Deploy', body: 'Writes each output into the directory layout the tool expects. Idempotent and reversible.' },
]

const lines = ref([])
const typing = ref('')
const termEl = ref(null)
let alive = true
let timer

function wait(ms) {
  return new Promise((r) => { timer = setTimeout(r, ms) })
}

async function run(i) {
  if (!alive) return
  if (i >= SCRIPT.length) {
    await wait(2600)
    if (!alive) return
    lines.value = []
    typing.value = ''
    await wait(500)
    return run(0)
  }
  const step = SCRIPT[i]
  if (step.kind === 'cmd') {
    for (let c = 1; c <= step.text.length; c++) {
      if (!alive) return
      typing.value = step.text.slice(0, c)
      await wait(34 + Math.random() * 26)
    }
    await wait(320)
    if (!alive) return
    lines.value = [...lines.value, { kind: step.kind, mark: MARKS[step.kind], text: step.text }]
    typing.value = ''
    await wait(420)
  } else {
    lines.value = [...lines.value, { kind: step.kind, mark: MARKS[step.kind], text: step.text }]
    await wait(step.kind === 'dim' ? 520 : 170)
  }
  return run(i + 1)
}

watch(lines, () => {
  nextTick(() => {
    if (termEl.value) termEl.value.scrollTop = termEl.value.scrollHeight
  })
})

let io
onMounted(() => {
  run(0)

  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.style.transitionDelay = (e.target.dataset.delay || '0') + 'ms'
      e.target.classList.add('ul-in')
      io.unobserve(e.target)
    })
  }, { threshold: 0, rootMargin: '200% 0px -8% 0px' })
  document.querySelectorAll('.ulis-landing [data-reveal]').forEach((el) => io.observe(el))
})

onUnmounted(() => {
  alive = false
  clearTimeout(timer)
  if (io) io.disconnect()
})
</script>

<style>
.ulis-landing-page {
  --vp-nav-height: 56px;
  --vp-nav-bg-color: rgba(10, 10, 12, 0.85);
  --vp-c-bg: #0a0a0c;
  --vp-c-bg-alt: #0a0a0c;
  --vp-c-bg-elv: #131318;
  --vp-c-text-1: #e8e6e1;
  --vp-c-text-2: #96948e;
  --vp-c-text-3: #6f6e69;
  --vp-c-divider: rgba(255, 255, 255, 0.08);
  --vp-c-gutter: rgba(255, 255, 255, 0.08);
  --vp-c-brand-1: #3595b8;
  --vp-c-brand-2: #37819c;
  --vp-c-brand-3: #1f4f61;
}
.ulis-landing-page .VPNavBarAppearance,
.ulis-landing-page .VPNavScreenAppearance {
  display: none;
}

/* body sits behind the translucent nav; without this its default (non-landing) bg shows through the blur */
body:has(.ulis-landing-page) {
  background-color: #0a0a0c;
}

/* VitePress only fixes the nav to top at >=960px; pin it fixed at every width */
.ulis-landing-page .VPNav {
  position: fixed !important;
  top: 0;
  left: 0;
  width: 100%;
}
.ulis-landing-page .VPContent {
  padding-top: var(--vp-nav-height) !important;
}

/* Restyle the real VPNav to match the console design instead of replacing it */
.ulis-landing-page .VPNavBar {
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--vp-c-divider);
}
.ulis-landing-page .VPNavBar .divider { display: none; }
.ulis-landing-page .VPNavBar .wrapper { padding: 0 24px; }
.ulis-landing-page .VPNavBar .container { max-width: 1280px; }
/* leftover framework divider from the now-hidden appearance toggle */
.ulis-landing-page .VPNavBarSocialLinks::before { display: none; }
.ulis-landing-page .VPNavBar .social-links { border-left: none; }
.ulis-landing-page .VPNavBarTitle .title {
  font-family: 'JetBrains Mono', var(--vp-font-family-mono);
  font-size: 15px;
  font-weight: 700;
}
.ulis-landing-page .VPNavBarTitle .title::before {
  content: '';
  width: 9px;
  height: 9px;
  margin-right: 10px;
  background: var(--vp-c-brand-1);
  display: block;
  flex-shrink: 0;
}
.ulis-landing-page .VPNavBarMenu {
  height: var(--vp-nav-height);
}
.ulis-landing-page .VPNavBarMenuLink {
  font-family: 'JetBrains Mono', var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 400;
  text-transform: lowercase;
  padding: 0 20px;
  border-right: 1px solid var(--vp-c-divider);
  transition: color .15s, background-color .15s;
}
.ulis-landing-page .VPNavBarMenuLink:hover,
.ulis-landing-page .VPNavBarMenuLink.active {
  background: rgba(255, 255, 255, 0.04);
}
.ulis-landing-page .VPNavBarSocialLinks {
  padding-left: 16px;
  margin-left: 4px;
  border-left: 1px solid var(--vp-c-divider);
}
.ulis-landing-page .VPNavBarExtra .menu .group:first-of-type {
    display: none;
}

/* Restyle the real VPFooter to match the console design instead of replacing it */
.ulis-landing-page .VPFooter {
  background-color: var(--vp-c-bg);
  border-top: none;
}
.ulis-landing-page .VPFooter .container {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  max-width: 1280px;
}
.ulis-landing-page .VPFooter .message,
.ulis-landing-page .VPFooter .copyright {
  font-family: 'JetBrains Mono', var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: normal;
}

.VPHome { margin-bottom: 0 !important; }

.ulis-landing {
  --ul-bg: #0a0a0c;
  --ul-fg: #e8e6e1;
  --ul-accent: #3595b8;
  --ul-accent-hover: #37819c;
  --ul-muted: #96948e;
  --ul-dim: #6f6e69;
  --ul-line: rgba(255, 255, 255, 0.08);
  margin-left: calc(50% - 50vw);
  width: 100vw;
  background: var(--ul-bg);
  color: var(--ul-fg);
  font-family: 'JetBrains Mono', var(--vp-font-family-mono);
  background-image: radial-gradient(rgba(255, 255, 255, 0.055) 1px, transparent 1px);
  background-size: 26px 26px;
}
.ulis-landing a { color: var(--ul-fg); text-decoration: none; }
.ulis-landing [data-reveal] {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity .75s cubic-bezier(.2,.7,.2,1), transform .75s cubic-bezier(.2,.7,.2,1);
}
.ulis-landing [data-reveal].ul-in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .ulis-landing [data-reveal] { opacity: 1; transform: none; transition: none; }
}
.ulis-landing .ul-accent { color: var(--ul-accent); }
.ulis-landing .ul-dim { color: var(--ul-dim); }
.ulis-landing .ul-hl { color: var(--ul-fg); }

.ul-hero {
  max-width: 1280px;
  margin: 0 auto;
  padding: 76px 24px 56px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  align-items: flex-start;
}
.ul-badge {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600;
  color: var(--ul-accent); border: 1px solid rgba(53,149,184,0.3); padding: 4px 10px;
}
.ul-hero h1 {
  margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 64px; line-height: 0.98;
  letter-spacing: -0.045em; font-weight: 600; text-wrap: balance;
}
.ul-sub {
  margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 18px; line-height: 1.6;
  color: var(--ul-muted); max-width: 42ch; text-wrap: pretty;
}
.ul-cta-row { display: flex; gap: 10px; flex-wrap: wrap; font-family: 'Space Grotesk', sans-serif; }
.ulis-landing .ul-btn { font-weight: 600; font-size: 15px; padding: 12px 22px; transition: background-color .15s, border-color .15s; }
.ulis-landing .ul-btn-primary { background: var(--ul-accent); color: var(--ul-bg); }
.ulis-landing .ul-btn-primary:hover { background: var(--ul-accent-hover); color: var(--ul-bg); }
.ulis-landing .ul-btn-ghost { border: 1px solid rgba(255,255,255,0.16); color: var(--ul-fg); font-weight: 500; }
.ulis-landing .ul-btn-ghost:hover { border-color: var(--ul-accent); color: var(--ul-fg); }
.ul-targets {
  width: 100%; margin-top: 12px; display: flex; flex-wrap: wrap; gap: 12px 28px;
  font-size: 12.5px; color: var(--ul-dim);
}
.ul-target { display: flex; align-items: center; gap: 9px; }
.ul-dot { width: 5px; height: 5px; background: var(--ul-accent); display: block; }
.ul-target-name { color: #b4b2ac; }

.ul-terminal-wrapper {
    padding: 0 24px;
}
.ul-terminal {
  position: relative; max-width: 900px; margin: 0 auto 56px; border: 1px solid rgba(255,255,255,0.10);
  border-radius: 14px; background: linear-gradient(180deg, #131318, #0b0b0e);
  box-shadow: 0 40px 110px -40px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.02) inset;
  overflow: hidden;
}
.ul-terminal::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(53,149,184,0.07), transparent 40%); pointer-events: none;
}
.ul-terminal-scan {
  position: absolute; left: 0; right: 0; height: 60px;
  background: linear-gradient(180deg, transparent, rgba(53,149,184,0.05), transparent);
  animation: ulisScan 7s linear infinite; pointer-events: none;
}
@keyframes ulisScan { from { transform: translateY(-100%); } to { transform: translateY(1200%); } }
.ul-terminal-head {
  position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.025);
}
.ul-tl-dots { display: flex; gap: 7px; }
.ul-tl-dots span { width: 11px; height: 11px; border-radius: 99px; background: #3a3a40; display: block; }
.ul-tl-title { flex: 1; text-align: center; font-size: 12px; color: var(--ul-dim); }
.ul-tl-shell { font-size: 11px; color: var(--ul-dim); }
.ul-terminal-body {
  position: relative; padding: 24px 32px 34px; font-size: 14px; line-height: 1.9;
  height: 400px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.16) transparent;
}
.ul-line { display: flex; gap: 10px; white-space: pre-wrap; word-break: break-word; }
.ul-mark { color: transparent; }
.ul-line-cmd .ul-mark, .ul-line-ok .ul-mark, .ul-mark-cmd { color: var(--ul-accent); }
.ul-line-cmd .ul-text { color: var(--ul-fg); }
.ul-line-ok .ul-text { color: #b4b2ac; }
.ul-line-dim .ul-text { color: var(--ul-dim); }
.ul-caret {
  display: inline-block; width: 8px; height: 15px; margin-left: 1px; transform: translateY(2px);
  background: var(--ul-accent); animation: ulisBlink 1s steps(1) infinite;
}
@keyframes ulisBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

.ul-pipeline { max-width: 1280px; margin: 0 auto; padding: 56px 24px 60px; }
.ul-eyebrow { font-size: 11.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ul-dim); margin-bottom: 26px; }
.ul-pipe-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid var(--ul-line); }
.ul-pipe-step {
  padding: 28px 24px 32px; border-right: 1px solid var(--ul-line); display: flex; flex-direction: column; gap: 10px;
  background: rgba(255,255,255,0.015); transition: background-color .15s;
}
.ul-pipe-step:last-child { border-right: none; }
.ul-pipe-step:hover { background: rgba(53,149,184,0.06); }
.ul-pipe-cmd { font-size: 12px; color: var(--ul-accent); }
.ul-pipe-title { font-family: 'Space Grotesk', sans-serif; font-size: 19px; font-weight: 600; letter-spacing: -0.02em; }
.ul-pipe-body { font-family: 'Space Grotesk', sans-serif; font-size: 14.5px; line-height: 1.55; color: #8c8a85; text-wrap: pretty; }

.ul-tree-wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
.ul-tree-grid { border: 1px solid var(--ul-line); display: grid; grid-template-columns: 1fr 1fr; }
.ul-tree { padding: 52px 40px; border-right: 1px solid var(--ul-line); }
.ul-tree-right { border-right: none; }
.ul-tree-body { font-size: 13.5px; line-height: 2.05; color: #b4b2ac; }

.ul-cta-wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
.ul-cta-box {
  border: 1px solid var(--ul-line); border-top: none; padding: 70px 40px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  background: radial-gradient(ellipse at 50% 120%, rgba(53,149,184,0.12), transparent 60%);
}
.ul-cta-box h2 {
  margin: 0; font-family: 'Space Grotesk', sans-serif; font-size: 40px; line-height: 1.15;
  letter-spacing: -0.035em; font-weight: 600; max-width: 20ch; text-wrap: balance; border: none; padding: 0;
}
.ul-cta-box code {
  font-size: 14.5px; color: #c8c6c0; border: 1px solid rgba(255,255,255,0.14); padding: 13px 20px;
  background: rgba(0,0,0,0.4); font-family: 'JetBrains Mono', monospace;
}

@media (max-width: 768px) {
  .ul-hero h1 { font-size: 40px; }
  .ul-pipe-grid { grid-template-columns: 1fr; }
  .ul-pipe-step { border-right: none; border-bottom: 1px solid var(--ul-line); }
  .ul-tree-grid { grid-template-columns: 1fr; }
  .ul-tree { border-right: none; border-bottom: 1px solid var(--ul-line); }
  .ul-cta-box h2 { font-size: 28px; }
}
</style>
