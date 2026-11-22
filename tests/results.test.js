import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidUsername,
  normalizeUsername,
  parseRegisteredUnits,
  validateResultsRequest,
} from "../api/results.js";

test("usernames normalize case and accept safe 3–32 character identifiers", () => {
  assert.equal(normalizeUsername("  Rina_42 "), "rina_42");
  assert.equal(isValidUsername("Rina_42"), true);
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("has space"), false);
});

test("registered units accept multiline or delimited input and remove duplicates", () => {
  assert.deepEqual(parseRegisteredUnits("MAT 101\nENG 202, MAT 101"), [
    "MAT 101",
    "ENG 202",
  ]);
  assert.throws(() => parseRegisteredUnits(""), /registered units/i);
  assert.throws(
    () =>
      parseRegisteredUnits(
        Array.from({ length: 41 }, (_, index) => `Unit ${index + 1}`),
      ),
    /1 and 40/i,
  );
});

test("academic results requests require institution, registration, admission and units", () => {
  assert.deepEqual(
    validateResultsRequest({
      institutionName: "  Example   University ",
      registrationNumber: "REG-0102",
      admissionNumber: "ADM-88",
      registeredUnits: ["MAT 101", "ENG 202"],
    }),
    {
      institutionName: "Example University",
      registrationNumber: "REG-0102",
      admissionNumber: "ADM-88",
      registeredUnits: ["MAT 101", "ENG 202"],
    },
  );
  assert.throws(
    () =>
      validateResultsRequest({
        institutionName: "Example University",
        registrationNumber: "REG-0102",
        admissionNumber: "ADM-88",
        registeredUnits: [],
      }),
    /registered units/i,
  );
});
