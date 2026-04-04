/**
 * Web Worker: builds price matrices + full-list sort permutations off the main thread.
 */
import { createRecipeSortEngine } from "./recipe-sort.js";
import { itemCatalogSortPermutation as SP } from "./sort-permutation-core.js";

const workerState = {
  data: { ItemList: [], recipesByProduct: {}, recipesByIngredient: {} },
  blockTypes: {},
  itemByName: new Map(),
  recipeSortEngine: null,
};

function initWorkerPayload(payload) {
  workerState.data.ItemList = (payload && payload.ItemList) || [];
  workerState.data.recipesByProduct =
    (payload && payload.recipesByProduct) || {};
  workerState.data.recipesByIngredient =
    (payload && payload.recipesByIngredient) || {};
  workerState.blockTypes =
    payload && payload.blockTypes && typeof payload.blockTypes === "object"
      ? payload.blockTypes
      : {};
  workerState.itemByName.clear();
  const items = workerState.data.ItemList;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && typeof it.name === "string" && it.name) {
      workerState.itemByName.set(it.name, it);
    }
  }
  workerState.recipeSortEngine = createRecipeSortEngine();
  workerState.recipeSortEngine.setData({
    ItemList: workerState.data.ItemList,
    recipesByProduct: workerState.data.recipesByProduct,
    recipesByIngredient: workerState.data.recipesByIngredient,
  });
  workerState.recipeSortEngine.clearCache();
}

let sortBind = null;
function getSortBind() {
  if (!sortBind) {
    sortBind = SP.createBindings({
      getData: function () {
        return workerState.data;
      },
      getBlockTypes: function () {
        return workerState.blockTypes;
      },
      getItemByName: function () {
        return workerState.itemByName;
      },
      getRecipeSortEngine: function () {
        return workerState.recipeSortEngine;
      },
      getWisdomStat: function () {
        return 0;
      },
    });
  }
  return sortBind;
}

function postError(epoch, err) {
  self.postMessage({
    type: "error",
    epoch: epoch,
    message: err && err.message ? err.message : String(err),
  });
}

function handleBuildMatrices(epoch, payload) {
  try {
    initWorkerPayload(payload);
    const L = getSortBind();
    L.invalidatePriceMatricesCache();
    L.precomputePriceMatrices();
    const bufs = L.cloneMatrixBuffersForTransfer();
    const n = payload && payload.ItemList ? payload.ItemList.length : 0;
    self.postMessage(
      {
        type: "matrices",
        epoch: epoch,
        n: n,
        buy: bufs.buy,
        sell: bufs.sell,
        comp: bufs.comp,
        profit: bufs.profit,
      },
      [bufs.buy, bufs.sell, bufs.comp, bufs.profit],
    );
  } catch (err) {
    postError(epoch, err);
  }
}

function handleRunPermutations(epoch, msg) {
  const jobs = Array.isArray(msg.jobs) ? msg.jobs : [];
  try {
    initWorkerPayload(msg.payload);
    const L = getSortBind();
    L.applyMatricesFromWorkerBuffers(
      msg.n,
      msg.buy,
      msg.sell,
      msg.comp,
      msg.profit,
    );

    for (let ji = 0; ji < jobs.length; ji++) {
      const job = jobs[ji];
      const key = L.sortCacheKey(
        job.col,
        job.dirStr,
        job.secondary,
        job.wisdomSlice,
      );
      const perm = L.buildSortPermutation({
        col: job.col,
        dir: job.dir,
        secondary: job.secondary,
        wisdom: job.wisdomSlice,
      });
      self.postMessage(
        {
          type: "job",
          epoch: epoch,
          key: key,
          done: ji + 1,
          total: jobs.length,
          perm: perm.buffer,
        },
        [perm.buffer],
      );
    }

    self.postMessage({
      type: "done",
      epoch: epoch,
      totalJobs: jobs.length,
    });
  } catch (err) {
    postError(epoch, err);
  }
}

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg) return;
  const epoch = msg.epoch;
  if (msg.type === "buildMatrices") {
    handleBuildMatrices(epoch, msg.payload);
    return;
  }
  if (msg.type === "runPermutations") {
    handleRunPermutations(epoch, msg);
    return;
  }
};
