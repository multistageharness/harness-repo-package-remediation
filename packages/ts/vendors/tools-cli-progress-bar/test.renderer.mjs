import {
  ProgressBar,
  SilentProgressRenderer,
  CLIProgressHelper,
} from "./main.mjs";
import assert from "assert";

class ProgressBarTest {
  static testBasicSilentProgress() {
    const progressBar = ProgressBar.createSilent(100, "Test Progress");

    // Test incremental updates
    for (let i = 1; i <= 100; i++) {
      const progress = progressBar.update(1);
      assert.equal(progress.current, i);
      assert.equal(progress.percentage, i);
    }

    // Test completion
    const finalProgress = progressBar.getProgress();
    assert.equal(finalProgress.isComplete, true);

    console.log("✓ Basic progress test passed");
  }

  static testSilentProgressRendererHistory() {
    const silentRenderer = new SilentProgressRenderer();
    const progressBar = new ProgressBar(10, "History Test", silentRenderer);

    // Generate progress updates
    for (let i = 0; i < 10; i++) {
      progressBar.update(1);
    }

    const history = silentRenderer.getHistory();
    assert.equal(history.length, 10);
    assert.equal(history[9].percentage, 100);

    console.log("✓ Progress history test passed");
  }

  static async testAsyncProgress() {
    let progressCount = 0;

    await CLIProgressHelper.withProgress(
      5,
      "Async Test",
      async (updateProgress) => {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          updateProgress(1);
          progressCount++;
        }
      }
    );

    assert.equal(progressCount, 5);
    console.log("✓ Async progress test passed");
  }
}

// Run tests
ProgressBarTest.testBasicSilentProgress();
ProgressBarTest.testSilentProgressRendererHistory();
await ProgressBarTest.testAsyncProgress();
