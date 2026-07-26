import assert from "node:assert/strict";
import test from "node:test";
import { featureEnabled } from "../lib/feature-enabled.ts";

function withFlag(value: string | undefined, callback: () => void): void {
	const previous = process.env.TEST_FEATURE_ENABLED;
	try {
		if (value === undefined) delete process.env.TEST_FEATURE_ENABLED;
		else process.env.TEST_FEATURE_ENABLED = value;
		callback();
	} finally {
		if (previous === undefined) delete process.env.TEST_FEATURE_ENABLED;
		else process.env.TEST_FEATURE_ENABLED = previous;
	}
}

test("feature flags default on and are disabled by zero", () => {
	withFlag(undefined, () => assert.equal(featureEnabled("TEST_FEATURE_ENABLED"), true));
	withFlag("1", () => assert.equal(featureEnabled("TEST_FEATURE_ENABLED"), true));
	withFlag("0", () => assert.equal(featureEnabled("TEST_FEATURE_ENABLED"), false));
});
