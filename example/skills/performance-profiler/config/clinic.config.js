/**
 * Clinic.js Configuration
 *
 * Configuration for Clinic.js performance profiling tools
 * Tools: doctor, flame, bubbleprof
 */

module.exports = {
  // Clinic Doctor - Event loop diagnostics
  doctor: {
    // Sample rate in Hz (higher = more accurate but more overhead)
    sampleRate: 10,

    // Minimum delay to report (ms)
    minDelay: 50,

    // Output directory
    dest: ".clinic",

    // Open report in browser after completion
    open: true,

    // Detection thresholds
    thresholds: {
      // Event loop delay threshold (ms)
      eventLoopDelay: 100,

      // CPU usage threshold (%)
      cpuUsage: 80,

      // Memory usage threshold (MB)
      memoryUsage: 512,
    },
  },

  // Clinic Flame - CPU flamegraphs
  flame: {
    // Sample rate in Hz
    sampleRate: 1000,

    // Output directory
    dest: ".clinic",

    // Open report in browser
    open: true,

    // Collect arguments (more detail, more overhead)
    collectArguments: false,

    // Kernel tracing (Linux only)
    kernelTracing: false,
  },

  // Clinic Bubbleprof - Async operations
  bubbleprof: {
    // Output directory
    dest: ".clinic",

    // Open report in browser
    open: true,

    // Sample rate in Hz
    sampleRate: 10,

    // Show system operations
    showSystem: false,
  },

  // Global settings
  global: {
    // Maximum profile duration (ms) - auto-stop after this
    maxDuration: 60000, // 1 minute

    // Warmup time before profiling starts (ms)
    warmupTime: 5000, // 5 seconds

    // Output format
    outputFormat: "html", // 'html' or 'json'

    // Compression
    compress: true,

    // Debug mode
    debug: false,
  },
};
