import assert from "node:assert/strict";
import test from "node:test";
import { discoverContractStatus } from "../dist/index.js";
import { createDiscoverContractFixtureRequest } from "../dist/fixtures.js";

test("fixture requests retain the chosen origin without credentials or redirects", () => {
  const request = createDiscoverContractFixtureRequest("https://fixture.invalid", "/contract-fixture?version=1");
  assert.equal(request.url, "https://fixture.invalid/contract-fixture?version=1");
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.equal(discoverContractStatus, "proposed-unratified");
  for (const path of ["https://other.invalid", "//other.invalid", "/\\other.invalid", "/fixture#secret"]) {
    assert.throws(() => createDiscoverContractFixtureRequest("https://fixture.invalid", path));
  }
  assert.throws(() => createDiscoverContractFixtureRequest("https://user:secret@fixture.invalid", "/fixture"));
});
