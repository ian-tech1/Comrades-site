import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAvatarMime,
  parseFailedUnits,
  validateReferRequest,
} from "../api/service-requests.js";

test("failed units accept delimited input, normalize whitespace and deduplicate", () => {
  assert.deepEqual(parseFailedUnits("MAT 101\nENG 202, MAT 101"), [
    "MAT 101",
    "ENG 202",
  ]);
  assert.throws(() => parseFailedUnits(""), /failed units/i);
  assert.throws(
    () => parseFailedUnits(Array.from({ length: 41 }, (_, i) => `Unit ${i}`)),
    /1 and 40/i,
  );
});

test("supplementary registration validates identifiers, exam period and failed units", () => {
  assert.deepEqual(
    validateReferRequest({
      institutionName: "  Example   University ",
      registrationNumber: "REG-100",
      admissionNumber: "ADM-20",
      examPeriod: "May 2027",
      failedUnits: ["MAT 101", "PHY 102"],
      notes: "Please register me for the next sitting.",
    }),
    {
      institutionName: "Example University",
      registrationNumber: "REG-100",
      admissionNumber: "ADM-20",
      examPeriod: "May 2027",
      failedUnits: ["MAT 101", "PHY 102"],
      notes: "Please register me for the next sitting.",
    },
  );
  assert.throws(
    () =>
      validateReferRequest({
        institutionName: "Example University",
        registrationNumber: "REG-100",
        admissionNumber: "ADM-20",
        examPeriod: "",
        failedUnits: ["MAT 101"],
      }),
    /exam period/i,
  );
});

test("profile photos require JPEG, PNG or WebP file signatures", () => {
  assert.equal(
    detectAvatarMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    "image/jpeg",
  );
  assert.equal(
    detectAvatarMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(detectAvatarMime(Buffer.from("RIFF0000WEBP")), "image/webp");
  assert.equal(detectAvatarMime(Buffer.from("image/png")), "");
});
