import { ProgressTracker } from "./main.mjs";

class MockProgressSystem {
  constructor() {
    this.progressEvents = [];
  }

  createMockProgress(total, description) {
    const tracker = new ProgressTracker(total, description);

    tracker.addObserver((progressData) => {
      this.progressEvents.push({
        timestamp: Date.now(),
        ...progressData,
      });
    });

    return tracker;
  }

  getProgressEvents() {
    return this.progressEvents;
  }

  clearEvents() {
    this.progressEvents = [];
  }
}

// Usage in tests
const mockSystem = new MockProgressSystem();
const tracker = mockSystem.createMockProgress(50, "Mock Test");

for (let i = 0; i < 50; i++) {
  tracker.increment(1);
}

const events = mockSystem.getProgressEvents();
console.log(`Captured ${events.length} progress events`);
