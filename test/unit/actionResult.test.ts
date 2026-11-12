import { describe, expect, it } from "vitest";
import { ActionResult } from "#shared/utils/actionResult";

describe("ActionResult", () => {
	it("builds a success with a payload", () => {
		expect(ActionResult.ok("Saved.", { id: 1 })).toEqual({
			Success: true,
			Message: "Saved.",
			ResponseObject: { id: 1 },
		});
	});

	it("builds a success without a payload", () => {
		expect(ActionResult.ok("Deleted.")).toEqual({ Success: true, Message: "Deleted.", ResponseObject: null });
	});

	it("builds a failure, with null when there is no payload", () => {
		expect(ActionResult.fail("No.")).toEqual({ Success: false, Message: "No.", ResponseObject: null });
		expect(ActionResult.fail("Taken.", { id: 2 }).ResponseObject).toEqual({ id: 2 });
	});
});
