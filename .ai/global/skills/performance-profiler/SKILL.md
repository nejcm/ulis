---
name: performance-profiler
description: CPU/memory profiling and performance benchmarking with advanced analysis
category: performance
version: "2.0.0"
model: claude-sonnet-4-6
platforms:
  codex:
    model: gpt-5.4
---

# Performance Profiler Skill

Comprehensive performance profiling for CPU, memory, and benchmarking with advanced analysis and optimization guidance.

## Purpose

- Profile CPU usage and identify hotspots
- Analyze memory usage and detect leaks
- Execute performance benchmarks
- Generate and interpret flamegraphs
- Provide actionable optimization recommendations
- Track performance over time

## Quick Start

```bash
# Node.js CPU profiling
npx clinic doctor -- node app.js

# Python CPU profiling
py-spy record -o profile.svg -- python app.py

# Memory profiling
node --inspect app.js  # Use Chrome DevTools

# Benchmarking
npx autocannon http://localhost:3000
```

---

## Detailed Tool Setup

### Node.js Profiling Tools

#### 1. Built-in Node.js Profiler

**Installation:** Built-in (no installation needed)

**Basic Usage:**

```bash
# Start profiling
node --prof app.js

# Process the log file
node --prof-process isolate-*.log > profile.txt
```

**Interpretation:**

- **Self time >10%** indicates a hotspot
- Focus on functions you control (not Node.js internals)
- Look for unexpected functions in top 10

**Example Output:**

```
[Summary]:
   ticks  total  nonlib   name
   4234   42.3%   45.2%  processOrder
   1872   18.7%   20.0%  validatePayment
   1240   12.4%   13.3%  queryDatabase
```

**When to use:** Quick profiling, production debugging

#### 2. Clinic.js Suite

**Installation:**

```bash
npm install -g clinic
```

**Three Tools:**

**A) Clinic Doctor** - Event loop diagnostics

```bash
clinic doctor -- node app.js

# What to look for:
# - Delayed operations (event loop blocked)
# - Heavy I/O (red bars)
# - CPU usage spikes
```

**Interpretation:**

- **Red sections** = Event loop delay (bad)
- **Green sections** = Healthy event loop
- **Large gaps** = Long blocking operations

**Example findings:**

```
⚠️ Detected Issues:
- Event loop delay: 450ms (should be <100ms)
- Likely cause: Synchronous file I/O in handlers
- Recommendation: Use async file operations
```

**B) Clinic Flame** - CPU flamegraphs

```bash
clinic flame -- node app.js

# What to look for:
# - Wide bars = hotspots (lots of time)
# - Stack depth = call hierarchy
# - Color = file/module
```

**Interpretation:**

- **Width** = CPU time spent (wider = slower)
- **Height** = Stack depth (deep = many nested calls)
- **Hover** = Function name and percentage

**C) Clinic Bubbleprof** - Async operations

```bash
clinic bubbleprof -- node app.js

# What to look for:
# - Large bubbles = slow async operations
# - Lines = async relationships
# - Clusters = bottlenecks
```

**Interpretation:**

- **Bubble size** = Operation duration
- **Lines between bubbles** = Async dependencies
- **Clusters** = Concurrent operations

#### 3. 0x Flamegraph Profiler

**Installation:**

```bash
npm install -g 0x
```

**Usage:**

```bash
0x app.js

# Opens flamegraph in browser
# Interactive: click to zoom, hover for details
```

**Advantages:**

- Beautiful interactive visualizations
- Easy to navigate
- Automatic optimization detection

#### 4. Autocannon Benchmarking

**Installation:**

```bash
npm install -g autocannon
```

**Usage:**

```bash
# Basic benchmark
autocannon http://localhost:3000

# Advanced options
autocannon -c 100 -d 30 -p 10 http://localhost:3000/api/users
# -c 100 = 100 concurrent connections
# -d 30 = 30 second duration
# -p 10 = 10 pipeline requests
```

**Output:**

```
Requests/sec: 12,345
Latency (avg): 8.1ms
Latency (p95): 23.4ms
Latency (p99): 45.2ms
```

**Interpretation:**

- **Requests/sec** = Throughput
- **Latency avg** = Typical response time
- **p95/p99** = Tail latency (worst case)

### Python Profiling Tools

#### 1. py-spy - Sampling Profiler

**Installation:**

```bash
pip install py-spy
```

**Usage:**

```bash
# Record flamegraph
py-spy record -o profile.svg -- python app.py

# Live top view
py-spy top --pid 12345

# Dump stack traces
py-spy dump --pid 12345
```

**Advantages:**

- No code changes needed
- Low overhead
- Works on running processes

#### 2. memory_profiler

**Installation:**

```bash
pip install memory_profiler
```

**Usage:**

```python
from memory_profiler import profile

@profile
def my_function():
    a = [1] * (10 ** 6)  # 8 MB
    b = [2] * (2 * 10 ** 7)  # 160 MB
    del b
    return a
```

**Run:**

```bash
python -m memory_profiler script.py
```

**Output:**

```
Line #    Mem usage    Increment  Occurrences   Line Contents
     3     38.8 MiB     38.8 MiB           1   @profile
     4     46.9 MiB      8.1 MiB           1       a = [1] * (10 ** 6)
     5    207.0 MiB    160.1 MiB           1       b = [2] * (2 * 10 ** 7)
     6     46.9 MiB   -160.1 MiB           1       del b
```

#### 3. cProfile (Built-in)

**Usage:**

```bash
python -m cProfile -o output.prof script.py

# Analyze results
python -m pstats output.prof
```

**Interactive analysis:**

```python
>>> import pstats
>>> p = pstats.Stats('output.prof')
>>> p.sort_stats('cumulative')
>>> p.print_stats(10)  # Top 10 functions
```

### System-Level Tools

#### 1. perf (Linux)

**Usage:**

```bash
# Record
perf record -F 99 -p $(pgrep node) -g -- sleep 30

# Report
perf report

# Flamegraph
perf script | stackcollapse-perf.pl | flamegraph.pl > perf.svg
```

#### 2. dtrace (macOS)

**Usage:**

```bash
# Profile all functions
sudo dtrace -n 'profile-997 /pid == $target/ { @[ustack()] = count(); }' -p $(pgrep node)
```

---

## Flamegraph Interpretation Guide

### What is a Flamegraph?

A flamegraph is a visualization of profiled software, showing:

- **X-axis (width)** = Time spent in function (wider = more time)
- **Y-axis (height)** = Stack depth (call hierarchy)
- **Color** = Different files/modules (not meaningful for performance)

### How to Read Flamegraphs

#### 1. Identify Hotspots (Wide Bars)

```
┌─────────────────────────────────────────────────────────┐
│                    main (100%)                          │ ← Root
├─────────────────────────┬───────────────────────────────┤
│   processOrder (45%)    │  handleRequest (55%)          │ ← Level 1
├────────┬────────────────┼──────────┬────────────────────┤
│validate│ calculate (20%)│ query    │ render (30%)       │ ← Level 2
│(25%)   │                │ (25%)    │                    │
└────────┴────────────────┴──────────┴────────────────────┘
         ↑ HOTSPOT                    ↑ HOTSPOT
```

**Finding:** `validate` (25%) and `render` (30%) are hotspots

#### 2. Understand Stack Depth

**Shallow stacks** (2-3 levels):

- ✅ Good: Simple, direct code
- ⚠️ May hide complexity in single functions

**Deep stacks** (10+ levels):

- ⚠️ Excessive abstraction or recursion
- May indicate over-engineering
- Check for tail call optimization

#### 3. Look for Patterns

**Pattern 1: Flat Top (Plateau)**

```
│   ┌─────────────────────┐
│   │  cpuIntensiveTask   │ ← Wide, flat = CPU-bound
│   └─────────────────────┘
```

**Meaning:** CPU-bound operation, algorithm optimization needed

**Pattern 2: Many Thin Bars**

```
│ │││││││││││││││││││││││ ← Many thin calls
│ ││ ││ ││ ││ ││ ││ ││
```

**Meaning:** High function call overhead, consider inlining

**Pattern 3: Uneven Distribution**

```
│ ┌──────────┐ ┌──┐ ┌─┐
│ │  60%     │ │10│ │5│ ← Dominated by one function
│ └──────────┘ └──┘ └─┘
```

**Meaning:** Single bottleneck, focus optimization here

#### 4. Interactive Flamegraphs

**Click to zoom:**

- Click a bar to zoom into that subtree
- See detailed breakdown of function

**Hover for details:**

- Function name
- Percentage of total time
- Absolute time (if available)

**Search:**

- Type to highlight matching functions
- Useful for finding specific functions

### Common Flamegraph Findings

#### Finding 1: Database Queries Dominating

```
└─ queryDatabase (40%)
   └─ executeQuery (38%)
      └─ mysql.query (37%)
```

**Root cause:** Slow database queries
**Fix:** Add indexes, optimize queries, use connection pooling

#### Finding 2: JSON Parsing Overhead

```
└─ JSON.parse (25%)
   └─ parseUserData (24%)
```

**Root cause:** Parsing large JSON repeatedly
**Fix:** Cache parsed objects, stream large JSON

#### Finding 3: Synchronous File I/O

```
└─ fs.readFileSync (30%)
```

**Root cause:** Blocking file operations
**Fix:** Use `fs.promises.readFile` instead

---

## Optimization Playbook

### Database Optimizations

#### Issue: Slow Queries

**Identify:**

```bash
# Enable slow query log (MySQL)
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5;  # Log queries >500ms
```

**Analyze:**

```sql
EXPLAIN SELECT * FROM users WHERE email = 'user@example.com';
```

**Fixes:**

1. **Add Indexes**

```sql
-- Before: Full table scan
SELECT * FROM users WHERE email = 'user@example.com';  # 450ms

-- After: Index scan
CREATE INDEX idx_users_email ON users(email);
SELECT * FROM users WHERE email = 'user@example.com';  # 8ms
```

2. **Query Optimization**

```sql
-- Bad: SELECT *
SELECT * FROM orders WHERE user_id = 123;  # Returns 50 columns

-- Good: Select only needed fields
SELECT id, total, created_at FROM orders WHERE user_id = 123;  # 3x faster
```

3. **Connection Pooling**

```javascript
// Bad: New connection per request
const conn = await mysql.createConnection(config);
const result = await conn.query('SELECT * FROM users');
await conn.end();  # Expensive!

// Good: Connection pool
const pool = mysql.createPool(config);
const result = await pool.query('SELECT * FROM users');  # Reuses connection
```

#### Issue: N+1 Queries

**Identify:**

```
Query: SELECT * FROM posts;  # 1 query
Query: SELECT * FROM users WHERE id = 1;  # N queries (once per post)
Query: SELECT * FROM users WHERE id = 2;
Query: SELECT * FROM users WHERE id = 3;
...
```

**Fix: Use JOIN or DataLoader**

```javascript
// Bad: N+1 queries
const posts = await db.query("SELECT * FROM posts");
for (const post of posts) {
  post.author = await db.query("SELECT * FROM users WHERE id = ?", [post.user_id]);
}

// Good: Single JOIN query
const posts = await db.query(`
  SELECT posts.*, users.name as author_name
  FROM posts
  JOIN users ON posts.user_id = users.id
`);
```

### API Optimizations

#### Issue: No Caching

**Before:**

```javascript
app.get('/api/stats', async (req, res) => {
  const stats = await expensiveCalculation();  # 2 seconds
  res.json(stats);
});
```

**After: Redis Cache**

```javascript
app.get('/api/stats', async (req, res) => {
  const cached = await redis.get('stats');
  if (cached) return res.json(JSON.parse(cached));  # <1ms

  const stats = await expensiveCalculation();
  await redis.set('stats', JSON.stringify(stats), 'EX', 300);  # Cache 5 min
  res.json(stats);
});
```

**Results:**

- First request: 2000ms
- Cached requests: <1ms
- **2000x improvement**

#### Issue: No Pagination

**Before:**

```javascript
// Returns all 10,000 users
app.get('/api/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');  # 3 seconds, 15MB
  res.json(users);
});
```

**After: Cursor Pagination**

```javascript
app.get('/api/users', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor || 0;

  const users = await db.query(
    'SELECT * FROM users WHERE id > ? LIMIT ?',
    [cursor, limit]
  );  # 50ms, 50KB

  res.json({
    users,
    next_cursor: users[users.length - 1]?.id
  });
});
```

**Results:**

- Response time: 3000ms → 50ms (**60x faster**)
- Payload size: 15MB → 50KB (**300x smaller**)

#### Issue: No Rate Limiting

**Add Rate Limiting:**

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  # 15 minutes
  max: 100,  # Max 100 requests per window
  message: 'Too many requests'
});

app.use('/api/', limiter);
```

### Frontend Optimizations

#### Issue: Large Bundle Size

**Analyze:**

```bash
npm run build
npx webpack-bundle-analyzer dist/stats.json
```

**Fixes:**

1. **Code Splitting**

```javascript
// Before: Import everything
import Dashboard from "./Dashboard";
import Analytics from "./Analytics";

// After: Lazy load
const Dashboard = lazy(() => import("./Dashboard"));
const Analytics = lazy(() => import("./Analytics"));
```

2. **Tree Shaking**

```javascript
// Bad: Imports entire library
import _ from 'lodash';  # 70KB

// Good: Import only what you need
import debounce from 'lodash/debounce';  # 2KB
```

3. **Image Optimization**

```bash
# Compress images
npm install -g imagemin-cli
imagemin images/*.{jpg,png} --out-dir=optimized

# Use WebP format
cwebp image.jpg -o image.webp  # 30-50% smaller
```

#### Issue: Render Blocking

**Before:**

```html
<script src="app.js"></script>
<!-- Blocks rendering -->
```

**After:**

```html
<script src="app.js" defer></script>
<!-- Non-blocking -->
```

### Algorithmic Optimizations

#### Issue: O(n²) Algorithm

**Before: O(n²)**

```javascript
// Find duplicates - nested loops
function findDuplicates(arr) {
  const duplicates = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j]) {
        duplicates.push(arr[i]);
      }
    }
  }
  return duplicates;
}
// Time: 100,000 items = 10 billion comparisons
```

**After: O(n)**

```javascript
// Use Set for O(1) lookups
function findDuplicates(arr) {
  const seen = new Set();
  const duplicates = new Set();

  for (const item of arr) {
    if (seen.has(item)) {
      duplicates.add(item);
    }
    seen.add(item);
  }

  return Array.from(duplicates);
}
// Time: 100,000 items = 100,000 operations
```

**Results:** 10,000ms → 10ms (**1000x faster**)

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Performance Profiling

on:
  pull_request:
    branches: [main]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Run benchmarks
        run: npm run benchmark > benchmark.txt

      - name: Load baseline
        run: |
          BASELINE=$(cat baseline/benchmark.txt | grep "Requests/sec" | awk '{print $2}')
          CURRENT=$(cat benchmark.txt | grep "Requests/sec" | awk '{print $2}')
          echo "Baseline: $BASELINE req/s"
          echo "Current: $CURRENT req/s"

          # Fail if 10% slower
          THRESHOLD=$(echo "$BASELINE * 0.9" | bc)
          if (( $(echo "$CURRENT < $THRESHOLD" | bc -l) )); then
            echo "❌ Performance regression detected"
            exit 1
          fi

      - name: Profile with Clinic
        run: npx clinic doctor -- node server.js &

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: performance-report
          path: .clinic/
```

### Performance Budget

**package.json:**

```json
{
  "scripts": {
    "benchmark": "autocannon -c 100 -d 30 http://localhost:3000",
    "perf:check": "node scripts/check-performance-budget.js"
  }
}
```

**scripts/check-performance-budget.js:**

```javascript
const budget = {
  responseTime: 200, // ms
  throughput: 5000, // req/s
  memory: 512, // MB
};

// Run benchmark and compare
const results = runBenchmark();

if (results.responseTime > budget.responseTime) {
  console.error(`❌ Response time ${results.responseTime}ms exceeds budget ${budget.responseTime}ms`);
  process.exit(1);
}

console.log("✅ Performance budget met");
```

---

## Real-World Examples

### Example 1: API Endpoint Optimization

**Initial Profile:**

```
GET /api/dashboard - 2.3 seconds
├─ queryUserData (45%) - 1.0s
├─ queryOrders (30%) - 0.7s
├─ queryAnalytics (20%) - 0.5s
└─ renderResponse (5%) - 0.1s
```

**Optimizations Applied:**

1. Add database indexes → 1.0s → 0.3s
2. Parallelize queries → 1.7s → 0.7s
3. Add Redis cache → 0.7s → 0.05s

**Final Result:** 2.3s → 0.05s (**46x faster**)

### Example 2: Memory Leak Detection

**Profile showing leak:**

```
Memory over time:
  0min: 150 MB
  5min: 280 MB
 10min: 410 MB  ← Growing linearly
 15min: 540 MB

Root cause: Event listeners not removed
```

**Fix:**

```javascript
// Before: Leak
function subscribe() {
  eventBus.on('data', handleData);  # Never removed!
}

// After: Cleanup
function subscribe() {
  const handler = handleData.bind(this);
  eventBus.on('data', handler);

  return () => eventBus.off('data', handler);  # Return cleanup function
}
```

---

## Best Practices

### DO

✅ **Profile before optimizing** - Measure, don't guess
✅ **Focus on big wins** - Optimize hotspots first (80/20 rule)
✅ **Benchmark before/after** - Verify improvements
✅ **Set performance budgets** - Prevent regressions
✅ **Monitor in production** - Use APM tools (New Relic, Datadog)
✅ **Profile realistic scenarios** - Use production data volumes

### DON'T

❌ **Don't micro-optimize** - Focus on algorithmic improvements first
❌ **Don't guess** - Always profile before claiming something is slow
❌ **Don't optimize prematurely** - Profile first, optimize second
❌ **Don't sacrifice readability** - Unless performance is critical

---

## Configuration Files

See `config/` directory for:

- `clinic.config.js` - Clinic.js configuration
- `autocannon.config.json` - Benchmarking settings
- `perf.config` - Linux perf settings

---

## Related

- **Agent:** `@performance`
- **Skills:** `coverage-analyzer`, `code-quality`
- **Examples:** `examples/performance-optimization-example.md`

---

_Version 2.0.0 - Comprehensive profiling guide with advanced analysis_
