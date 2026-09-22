import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SourceTextModule, createContext } from "node:vm";

// Execute the installed runtime unchanged, so this regression protects the
// dependency patch rather than a copied implementation of its bookkeeping.
const runtimeUrl = new URL(
  "./refresh-runtime.js",
  import.meta.resolve("@vitejs/plugin-react"),
);
const runtimeSource = await readFile(runtimeUrl, "utf8");

/** Observe strong Map ownership deterministically without relying on GC timing. */
async function createHarness() {
  const maps = [];
  class ObservedMap extends Map {
    constructor(...args) {
      super(...args);
      maps.push(this);
    }
  }
  const timers = new Map();
  let nextTimer = 0;
  const forwarded = [];
  const refreshed = [];
  const retried = [];
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject: () => 1,
    onScheduleFiberRoot() {},
    onCommitFiberRoot(...args) {
      forwarded.push({ receiver: this, args });
    },
  };
  const window = { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook };
  const module = new SourceTextModule(runtimeSource, {
    identifier: runtimeUrl.href,
    context: createContext({
      Map: ObservedMap,
      window,
      console,
      setTimeout(callback) {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    }),
  });
  await module.link(() => {
    throw new Error("Unexpected import in the standalone refresh runtime");
  });
  await module.evaluate();
  const runtime = module.namespace;
  runtime.injectIntoGlobalHook(window);
  hook.inject({
    setRefreshHandler() {},
    scheduleRefresh(root) {
      refreshed.push(root);
    },
    scheduleRoot(root, element) {
      retried.push({ root, element });
    },
  });
  const root = { current: null };
  const element = {};
  const commit = (mounted, previouslyMounted, didError = false) => {
    root.current = {
      memoizedState: { element: mounted ? element : null },
      alternate: {
        memoizedState: { element: previouslyMounted ? element : null },
      },
    };
    hook.onCommitFiberRoot(1, root, 3, didError);
  };
  return {
    root,
    element,
    hook,
    commit,
    forwarded,
    refreshed,
    retried,
    retainedByStrongMap: () => maps.some((map) => map.has(root)),
    async edit() {
      const Before = () => null;
      const After = () => null;
      runtime.register(Before, "example");
      runtime.register(After, "example");
      assert.equal(
        runtime.validateRefreshBoundaryAndEnqueueUpdate(
          "example",
          { Component: Before },
          { Component: After },
        ),
        undefined,
      );
      for (const callback of timers.values()) await callback();
      timers.clear();
    },
  };
}

test("a second empty commit does not retain an intentionally unmounted root", async () => {
  const h = await createHarness();
  h.commit(true, false);
  assert.equal(h.retainedByStrongMap(), true);
  h.commit(false, true);
  assert.equal(h.retainedByStrongMap(), false);
  // R3F produces this additional empty commit after the unmount commit.
  h.commit(false, false);
  assert.equal(h.retainedByStrongMap(), false);
});

test("mounted roots still receive Fast Refresh updates", async () => {
  const h = await createHarness();
  h.commit(true, false);
  await h.edit();
  assert.deepEqual(h.refreshed, [h.root]);
  assert.deepEqual(h.retried, []);
});

test("errored roots remain retryable after a later empty commit", async () => {
  const h = await createHarness();
  h.hook.onScheduleFiberRoot(1, h.root, h.element);
  h.commit(true, false);
  h.commit(false, true, true);
  h.commit(false, false);
  await h.edit();
  assert.deepEqual(h.retried, [{ root: h.root, element: h.element }]);
  assert.deepEqual(h.refreshed, []);
});

test("existing DevTools commit hooks receive every commit unchanged", async () => {
  const h = await createHarness();
  h.commit(true, false);
  h.commit(false, true);
  h.commit(false, false);
  h.commit(false, false, true);
  assert.equal(h.forwarded.length, 4);
  for (const [index, call] of h.forwarded.entries()) {
    assert.equal(call.receiver, h.hook);
    assert.deepEqual(call.args, [1, h.root, 3, index === 3]);
  }
});
