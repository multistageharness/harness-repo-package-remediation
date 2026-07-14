#!/usr/bin/env node

/**
 * CLI Progress Tracking System with Enhanced Architecture
 * Implements Strategy, Builder, Observer, and State Machine patterns
 * Addresses floating-point precision, lifecycle management, and architectural concerns
 */

import process from "process";
import { performance } from "perf_hooks";

// ===== CORE INTERFACES =====
class IProgressRenderer {
  render(progressData) {
    throw new Error("render() must be implemented by subclass");
  }
  cleanup() {}
}

class IProgressCalculator {
  calculate(current, total, startTime, lastUpdate) {
    throw new Error("calculate() must be implemented by subclass");
  }
}

// ===== UTILITIES =====
class TerminalUtils {
  static get isInteractive() {
    return process.stdout.isTTY && process.env.CI !== "true";
  }

  static get columns() {
    return process.stdout.columns || 80;
  }

  static get supportsColor() {
    return process.stdout.isTTY && process.env.FORCE_COLOR !== "0";
  }

  static moveCursor(dx, dy) {
    if (this.isInteractive) {
      process.stdout.write(`\x1b[${dy}A\x1b[${dx}G`);
    }
  }

  static clearLine() {
    if (this.isInteractive) {
      process.stdout.write("\x1b[2K\r");
    }
  }

  static hideCursor() {
    if (this.isInteractive) {
      process.stdout.write("\x1b[?25l");
    }
  }

  static showCursor() {
    if (this.isInteractive) {
      process.stdout.write("\x1b[?25h");
    }
  }
}

class Colors {
  static get codes() {
    return {
      reset: "\x1b[0m",
      bright: "\x1b[1m",
      dim: "\x1b[2m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
    };
  }

  static colorize(text, color) {
    if (!TerminalUtils.supportsColor) return text;
    return `${this.codes[color] || ""}${text}${this.codes.reset}`;
  }

  static success(text) {
    return Colors.colorize(text, "green");
  }
  static error(text) {
    return Colors.colorize(text, "red");
  }
  static warning(text) {
    return Colors.colorize(text, "yellow");
  }
  static info(text) {
    return Colors.colorize(text, "cyan");
  }
  static dim(text) {
    return Colors.colorize(text, "dim");
  }
}

// ===== ENHANCED PROGRESS CALCULATOR =====
class StandardProgressCalculator extends IProgressCalculator {
  constructor() {
    super();
    this.speedHistory = [];
    this.maxHistorySize = 10;
  }

  calculate(current, total, startTime, lastUpdate) {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;

    // Fix floating-point precision issue
    const percentage =
      total > 0 ? Math.round((current / total) * 100 * 100) / 100 : 0;

    // Calculate speed with moving average
    const speed = this.calculateSpeed(current, elapsed);

    // Calculate ETA
    let eta = 0;
    if (current > 0 && current < total && speed > 0) {
      eta = (total - current) / speed;
    }

    return {
      current,
      total,
      percentage,
      elapsed,
      eta,
      speed,
      isComplete: current >= total,
      isIndeterminate: total <= 0,
    };
  }

  calculateSpeed(current, elapsed) {
    if (elapsed <= 0) return 0;

    const currentSpeed = current / elapsed;

    // Maintain speed history for smoothing
    this.speedHistory.push(currentSpeed);
    if (this.speedHistory.length > this.maxHistorySize) {
      this.speedHistory.shift();
    }

    // Return moving average
    return (
      this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length
    );
  }
}

// ===== ENHANCED PROGRESS TRACKER WITH STATE MANAGEMENT =====
class ProgressTracker {
  constructor(total, description = "Progress", calculator = null) {
    this.total = total;
    this.current = 0;
    this.description = description;
    this.startTime = performance.now();
    this.lastUpdateTime = this.startTime;
    this.calculator = calculator || new StandardProgressCalculator();
    this.observers = new Set();
    this.state = "idle";
    this.stateObservers = new Set();
  }

  addObserver(observer) {
    this.observers.add(observer);
    return () => this.observers.delete(observer); // Return cleanup function
  }

  removeObserver(observer) {
    return this.observers.delete(observer);
  }

  addStateObserver(observer) {
    this.stateObservers.add(observer);
    return () => this.stateObservers.delete(observer);
  }

  removeStateObserver(observer) {
    return this.stateObservers.delete(observer);
  }

  notifyObservers(progressData) {
    this.observers.forEach((observer) => {
      try {
        if (typeof observer === "function") {
          observer(progressData);
        } else if (observer.onProgress) {
          observer.onProgress(progressData);
        }
      } catch (error) {
        console.error("Observer error:", error);
      }
    });
  }

  notifyStateChange(newState, oldState) {
    this.stateObservers.forEach((observer) => {
      try {
        if (typeof observer === "function") {
          observer({ newState, oldState, tracker: this });
        } else if (observer.onStateChange) {
          observer.onStateChange({ newState, oldState, tracker: this });
        }
      } catch (error) {
        console.error("State observer error:", error);
      }
    });
  }

  setState(newState) {
    const oldState = this.state;
    if (oldState !== newState) {
      this.state = newState;
      this.notifyStateChange(newState, oldState);
    }
  }

  getState() {
    return this.state;
  }

  increment(amount = 1) {
    if (this.state === "completed") return this.getProgress();

    const previousCurrent = this.current;
    this.current = Math.min(this.total, this.current + amount);
    this.lastUpdateTime = performance.now();

    const progress = this.getProgress();

    // State transition detection
    if (progress.isComplete && this.state !== "completed") {
      this.setState("completed");
    }

    this.notifyObservers(progress);
    return progress;
  }

  getProgress() {
    const calculatedData = this.calculator.calculate(
      this.current,
      this.total,
      this.startTime,
      this.lastUpdateTime
    );

    return {
      ...calculatedData,
      description: this.description,
      state: this.state,
    };
  }

  reset() {
    this.current = 0;
    this.startTime = performance.now();
    this.lastUpdateTime = this.startTime;
    this.setState("idle");
    if (this.calculator.speedHistory) {
      this.calculator.speedHistory = [];
    }
  }

  complete() {
    if (this.state === "completed") {
      return this.getProgress();
    }

    this.current = this.total;
    this.setState("completed");
    return this.getProgress();
  }

  setTotal(total) {
    this.total = total;
    return this;
  }

  isCompleted() {
    return this.state === "completed";
  }
}

// ===== SPINNER UTILITY =====
class Spinner {
  constructor(frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]) {
    this.frames = frames;
    this.current = 0;
  }

  next() {
    const frame = this.frames[this.current];
    this.current = (this.current + 1) % this.frames.length;
    return frame;
  }

  static get presets() {
    return {
      dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      line: ["-", "\\", "|", "/"],
      arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
      bounce: ["⠁", "⠂", "⠄", "⠂"],
      clock: [
        "🕐",
        "🕑",
        "🕒",
        "🕓",
        "🕔",
        "🕕",
        "🕖",
        "🕗",
        "🕘",
        "🕙",
        "🕚",
        "🕛",
      ],
    };
  }
}

// ===== ENHANCED RENDERERS =====
class ConsoleProgressRenderer extends IProgressRenderer {
  constructor(config = {}) {
    super();
    this.config = {
      barLength: Math.min(config.barLength || 40, TerminalUtils.columns - 30),
      filledChar: config.filledChar || "█",
      emptyChar: config.emptyChar || "░",
      showETA: config.showETA !== false,
      showSpeed: config.showSpeed !== false,
      showPercentage: config.showPercentage !== false,
      precision: config.precision || 1,
      useColors: config.useColors !== false,
      template: config.template || null,
      updateThrottle: config.updateThrottle || 0,
      testMode: config.testMode || false,
      ...config,
    };
    this.lastLineLength = 0;
    this.spinner = null;
    this.lastRenderTime = 0;
    this.hasRenderedCompletion = false;
  }

  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600)
      return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor(
      (seconds % 3600) / 60
    )}m`;
  }

  formatSpeed(speed) {
    if (speed < 1) return `${(speed * 1000).toFixed(0)}ms/item`;
    if (speed < 100) return `${speed.toFixed(1)}/s`;
    return `${Math.round(speed)}/s`;
  }

  render(progressData) {
    const now = performance.now();

    // Throttle updates if configured
    if (
      this.config.updateThrottle > 0 &&
      now - this.lastRenderTime < this.config.updateThrottle
    ) {
      return;
    }
    this.lastRenderTime = now;

    const {
      current,
      total,
      percentage,
      eta,
      speed,
      description,
      isComplete,
      isIndeterminate,
      state,
    } = progressData;

    // Prevent duplicate completion messages
    if (isComplete && this.hasRenderedCompletion) {
      return;
    }

    if (this.config.template) {
      return this.renderTemplate(progressData);
    }

    let output = "";

    if (isIndeterminate) {
      if (!this.spinner) this.spinner = new Spinner();
      const spinnerFrame = this.spinner.next();
      output = `${description}: ${Colors.info(spinnerFrame)} Working...`;
    } else {
      const filledLength = Math.floor(
        (percentage / 100) * this.config.barLength
      );
      const emptyLength = this.config.barLength - filledLength;

      const filledColor = isComplete ? "green" : "cyan";
      const filledBar = this.config.useColors
        ? Colors.colorize(
            this.config.filledChar.repeat(filledLength),
            filledColor
          )
        : this.config.filledChar.repeat(filledLength);

      const emptyBar = this.config.useColors
        ? Colors.dim(this.config.emptyChar.repeat(emptyLength))
        : this.config.emptyChar.repeat(emptyLength);

      const bar = `[${filledBar}${emptyBar}]`;

      let stats = "";
      if (this.config.showPercentage) {
        const pct = this.config.useColors
          ? Colors.colorize(
              `${percentage.toFixed(this.config.precision)}%`,
              "bright"
            )
          : `${percentage.toFixed(this.config.precision)}%`;
        stats += ` ${pct}`;
      }

      stats += ` (${current}/${total})`;

      if (this.config.showSpeed && speed > 0) {
        stats += ` ${Colors.dim(this.formatSpeed(speed))}`;
      }

      if (this.config.showETA && eta > 0) {
        stats += ` ETA: ${Colors.dim(this.formatTime(eta))}`;
      }

      output = `${description}: ${bar}${stats}`;
    }

    // Clear previous line and write new one
    if (TerminalUtils.isInteractive) {
      TerminalUtils.clearLine();
      process.stdout.write(output);

      if (isComplete && !this.hasRenderedCompletion) {
        const completedMsg = this.config.useColors
          ? Colors.success(" ✓ Complete!")
          : " Complete!";
        process.stdout.write(completedMsg + "\n");
        this.hasRenderedCompletion = true;
      }
    } else {
      // Non-interactive mode - only show milestones
      if (
        isComplete ||
        current === 0 ||
        current % Math.ceil(total / 10) === 0
      ) {
        console.log(output);
      }
    }

    this.lastLineLength = output.length;
  }

  renderTemplate(progressData) {
    const template = this.config.template;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return progressData[key] !== undefined ? progressData[key] : match;
    });
  }

  cleanup() {
    if (TerminalUtils.isInteractive) {
      TerminalUtils.showCursor();
    }
    this.hasRenderedCompletion = false;
  }

  reset() {
    this.hasRenderedCompletion = false;
    this.lastRenderTime = 0;
  }
}

class SilentProgressRenderer extends IProgressRenderer {
  constructor() {
    super();
    this.progressHistory = [];
    this.lastProgress = null;
  }

  render(progressData) {
    this.lastProgress = { ...progressData };
    this.progressHistory.push({ ...progressData, timestamp: Date.now() });
  }

  getLastProgress() {
    return this.lastProgress;
  }

  getHistory() {
    return [...this.progressHistory]; // Return copy to prevent external mutation
  }

  clear() {
    this.progressHistory = [];
    this.lastProgress = null;
  }

  cleanup() {
    // Silent renderer doesn't need cleanup
  }

  reset() {
    this.clear();
  }
}

class MultiProgressRenderer extends IProgressRenderer {
  constructor(config = {}) {
    super();
    this.config = config;
    this.renderers = new Map();
    this.lineCount = 0;
  }

  addProgress(id, renderer) {
    this.renderers.set(id, renderer);
    this.lineCount++;
  }

  removeProgress(id) {
    if (this.renderers.delete(id)) {
      this.lineCount--;
    }
  }

  render(progressData, id) {
    const renderer = this.renderers.get(id);
    if (!renderer) return;
    renderer.render(progressData);
  }

  cleanup() {
    this.renderers.forEach((renderer) => renderer.cleanup());
  }

  reset() {
    this.renderers.forEach((renderer) => {
      if (renderer.reset) renderer.reset();
    });
  }
}

// ===== PROCESS MANAGER (for signal handling) =====
class ProcessManager {
  constructor() {
    this.cleanupTasks = new Set();
    this.isSetup = false;
  }

  setup() {
    if (this.isSetup) return;

    const cleanup = () => {
      this.cleanup();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", () => this.cleanup());

    this.isSetup = true;
  }

  addCleanupTask(task) {
    this.cleanupTasks.add(task);
    return () => this.cleanupTasks.delete(task);
  }

  cleanup() {
    this.cleanupTasks.forEach((task) => {
      try {
        task();
      } catch (error) {
        console.error("Cleanup error:", error);
      }
    });
  }
}

// Global process manager instance
const processManager = new ProcessManager();

// ===== ENHANCED PROGRESS BAR WITH STATE MANAGEMENT =====
class ProgressBar {
  constructor(total, description = "Progress", renderer = null) {
    this.tracker = new ProgressTracker(total, description);
    this.renderer = renderer || this.createDefaultRenderer();
    this.state = "idle"; // idle, active, completed, stopped
    this.updateInterval = null;
    this.cleanupFn = null;

    // Setup process management
    processManager.setup();

    // Listen to tracker state changes
    this.tracker.addStateObserver((stateData) => {
      if (stateData.newState === "completed") {
        this.state = "completed";
      }
    });
  }

  createDefaultRenderer() {
    if (!TerminalUtils.isInteractive) {
      return new SilentProgressRenderer();
    }
    return new ConsoleProgressRenderer();
  }

  start() {
    if (this.state !== "idle") return this;

    this.state = "active";
    this.tracker.setState("active");
    TerminalUtils.hideCursor();

    // Register cleanup
    this.cleanupFn = processManager.addCleanupTask(() => {
      this.stop();
      this.renderer.cleanup();
    });

    // For indeterminate progress, start auto-updating
    if (this.tracker.total <= 0) {
      this.updateInterval = setInterval(() => {
        if (this.state === "active") {
          this.renderer.render(this.tracker.getProgress());
        }
      }, 100);
    }

    return this;
  }

  stop() {
    if (this.state === "idle" || this.state === "stopped") return this;

    this.state = "stopped";
    TerminalUtils.showCursor();

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }

    return this;
  }

  update(increment = 1) {
    if (this.state === "completed") return this.getProgress();

    if (this.state === "idle") this.start();

    const progress = this.tracker.increment(increment);
    this.renderer.render(progress);

    if (progress.isComplete && this.state !== "completed") {
      this.state = "completed";
      this.stop();
    }

    return progress;
  }

  setTotal(total) {
    this.tracker.setTotal(total);
    return this;
  }

  complete() {
    if (this.state === "completed") {
      return this.getProgress(); // Idempotent - no double rendering
    }

    this.state = "completed";
    const progress = this.tracker.complete();
    this.renderer.render(progress);
    this.stop();
    return progress;
  }

  getProgress() {
    return this.tracker.getProgress();
  }

  reset() {
    this.tracker.reset();
    this.state = "idle";
    if (this.renderer.reset) {
      this.renderer.reset();
    }
    return this;
  }

  isCompleted() {
    return this.state === "completed";
  }

  getState() {
    return this.state;
  }

  // Observer pattern support
  onProgress(callback) {
    return this.tracker.addObserver(callback);
  }

  offProgress(callback) {
    return this.tracker.removeObserver(callback);
  }

  onStateChange(callback) {
    return this.tracker.addStateObserver(callback);
  }

  offStateChange(callback) {
    return this.tracker.removeStateObserver(callback);
  }

  // Factory methods for common configurations
  static createConsole(total, description, config = {}) {
    const renderer = new ConsoleProgressRenderer(config);
    return new ProgressBar(total, description, renderer);
  }

  static createSilent(total, description) {
    const renderer = new SilentProgressRenderer();
    return new ProgressBar(total, description, renderer);
  }

  static createSpinner(description, config = {}) {
    const renderer = new ConsoleProgressRenderer({
      ...config,
      showPercentage: false,
      showETA: false,
    });
    return new ProgressBar(0, description, renderer);
  }
}

// ===== ENHANCED BUILDER WITH TEST MODE =====
class ProgressBarBuilder {
  constructor() {
    this.config = {};
    this.total = 100;
    this.description = "Progress";
  }

  withTotal(total) {
    this.total = total;
    return this;
  }

  withDescription(description) {
    this.description = description;
    return this;
  }

  withBarLength(length) {
    this.config.barLength = length;
    return this;
  }

  withChars(filled, empty) {
    this.config.filledChar = filled;
    this.config.emptyChar = empty;
    return this;
  }

  withColors(enabled = true) {
    this.config.useColors = enabled;
    return this;
  }

  withPrecision(precision) {
    this.config.precision = precision;
    return this;
  }

  showETA(show = true) {
    this.config.showETA = show;
    return this;
  }

  showSpeed(show = true) {
    this.config.showSpeed = show;
    return this;
  }

  showPercentage(show = true) {
    this.config.showPercentage = show;
    return this;
  }

  withTemplate(template) {
    this.config.template = template;
    return this;
  }

  withTestMode(enabled = true) {
    this.config.testMode = enabled;
    this.config.updateThrottle = enabled ? 100 : 0; // Slower updates for visibility
    return this;
  }

  withUpdateThrottle(ms) {
    this.config.updateThrottle = ms;
    return this;
  }

  forSpinner() {
    this.total = 0;
    this.config.showPercentage = false;
    this.config.showETA = false;
    return this;
  }

  build() {
    if (this.config.testMode) {
      // Use a test-friendly renderer with throttling
      const renderer = new ConsoleProgressRenderer({
        ...this.config,
        updateThrottle: this.config.updateThrottle || 100,
      });
      return new ProgressBar(this.total, this.description, renderer);
    }

    const renderer = new ConsoleProgressRenderer(this.config);
    return new ProgressBar(this.total, this.description, renderer);
  }

  buildSilent() {
    const renderer = new SilentProgressRenderer();
    return new ProgressBar(this.total, this.description, renderer);
  }
}

// ===== MULTI-PROGRESS MANAGER =====
class MultiProgressManager {
  constructor() {
    this.progressBars = new Map();
    this.isActive = false;
  }

  add(id, total, description, config = {}) {
    const progressBar = new ProgressBarBuilder()
      .withTotal(total)
      .withDescription(description)
      .build();

    this.progressBars.set(id, progressBar);
    return progressBar;
  }

  get(id) {
    return this.progressBars.get(id);
  }

  remove(id) {
    const progressBar = this.progressBars.get(id);
    if (progressBar) {
      progressBar.stop();
      this.progressBars.delete(id);
    }
  }

  update(id, increment = 1) {
    const progressBar = this.progressBars.get(id);
    return progressBar ? progressBar.update(increment) : null;
  }

  complete(id) {
    const progressBar = this.progressBars.get(id);
    return progressBar ? progressBar.complete() : null;
  }

  clear() {
    this.progressBars.forEach((progressBar) => progressBar.stop());
    this.progressBars.clear();
  }
}

// ===== ENHANCED CLI INTEGRATION UTILITIES =====
class CLIProgressHelper {
  static async withProgress(total, description, asyncTask, config = {}) {
    const progressBar = new ProgressBarBuilder()
      .withTotal(total)
      .withDescription(description)
      .build();

    progressBar.start();

    try {
      const result = await asyncTask((increment = 1) => {
        progressBar.update(increment);
      });

      // Only complete if not already completed (prevents double rendering)
      if (!progressBar.isCompleted()) {
        progressBar.complete();
      }

      return result;
    } catch (error) {
      progressBar.stop();
      console.error(
        Colors.error(`\n✗ ${description} failed: ${error.message}`)
      );
      throw error;
    }
  }

  static async withSpinner(description, asyncTask) {
    const spinner = ProgressBar.createSpinner(description);
    spinner.start();

    try {
      const result = await asyncTask();
      spinner.stop();
      console.log(Colors.success(`✓ ${description} completed`));
      return result;
    } catch (error) {
      spinner.stop();
      console.error(Colors.error(`✗ ${description} failed: ${error.message}`));
      throw error;
    }
  }

  static async withProgressAndState(
    total,
    description,
    asyncTask,
    config = {}
  ) {
    const progressBar = new ProgressBarBuilder()
      .withTotal(total)
      .withDescription(description)
      .build();

    const stateHistory = [];

    // Track state changes
    const unsubscribeState = progressBar.onStateChange((stateData) => {
      stateHistory.push({
        timestamp: Date.now(),
        ...stateData,
      });
    });

    progressBar.start();

    try {
      const result = await asyncTask((increment = 1) => {
        progressBar.update(increment);
      });

      if (!progressBar.isCompleted()) {
        progressBar.complete();
      }

      unsubscribeState();
      return { result, stateHistory };
    } catch (error) {
      progressBar.stop();
      unsubscribeState();
      console.error(
        Colors.error(`\n✗ ${description} failed: ${error.message}`)
      );
      throw error;
    }
  }
}

// ===== DEMONSTRATION & EXAMPLES =====
async function demonstrateProgressBars() {
  console.log(
    Colors.colorize("=== CLI Progress Bar System Demo ===\n", "bright")
  );

  console.log(Colors.info("1. Basic Progress Bar:"));
  const basicBar = new ProgressBar(100, "Processing files").start();
  await simulateWork(basicBar, 100, 50);
  await sleep(500);

  console.log(Colors.info("\n2. Custom Styled Progress Bar:"));
  const customBar = new ProgressBarBuilder()
    .withTotal(50)
    .withDescription("Custom Processing")
    .withBarLength(30)
    .withChars("▓", "▒")
    .withPrecision(0)
    .showSpeed(true)
    .build()
    .start();
  await simulateWork(customBar, 50, 75);
  await sleep(500);

  console.log(Colors.info("\n3. Spinner for Indeterminate Progress:"));
  await CLIProgressHelper.withSpinner("Connecting to server", async () => {
    await sleep(2000);
  });

  console.log(Colors.info("\n4. Progress with Async Task:"));
  await CLIProgressHelper.withProgress(
    75,
    "Downloading",
    async (updateProgress) => {
      for (let i = 0; i < 75; i++) {
        await sleep(30);
        updateProgress(1);
      }
    }
  );

  console.log(Colors.info("\n5. Silent Progress (CI mode):"));
  const silentBar = ProgressBar.createSilent(10, "Test Progress");
  for (let i = 0; i < 10; i++) {
    silentBar.update(1);
  }
  console.log("Final progress:", silentBar.getProgress());
  console.log("History length:", silentBar.renderer.getHistory().length);

  console.log(Colors.info("\n6. Progress with State Tracking:"));
  const { result, stateHistory } = await CLIProgressHelper.withProgressAndState(
    20,
    "State Tracking Demo",
    async (updateProgress) => {
      for (let i = 0; i < 20; i++) {
        await sleep(50);
        updateProgress(1);
      }
      return "completed successfully";
    }
  );
  console.log("Result:", result);
  console.log("State changes:", stateHistory.length);

  console.log(Colors.success("\n✓ All demonstrations completed!"));
}

// Utility functions
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateWork(progressBar, total, delay = 50) {
  let completed = 0;
  while (completed < total) {
    const increment = Math.min(
      Math.floor(Math.random() * 5) + 1,
      total - completed
    );
    progressBar.update(increment);
    completed += increment;
    await sleep(delay + Math.random() * 50);
  }
}

// ===== MAIN EXECUTION =====
async function main() {
  if (import.meta.url === `file://${process.argv[1]}`) {
    try {
      await demonstrateProgressBars();
    } catch (error) {
      console.error(Colors.error(`Error: ${error.message}`));
      process.exit(1);
    }
  }
}

main().catch(console.error);

// ===== EXPORTS =====
export {
  ProgressBar,
  ProgressTracker,
  ConsoleProgressRenderer,
  SilentProgressRenderer,
  MultiProgressRenderer,
  ProgressBarBuilder,
  MultiProgressManager,
  CLIProgressHelper,
  Colors,
  TerminalUtils,
  Spinner,
  StandardProgressCalculator,
  ProcessManager,
};
