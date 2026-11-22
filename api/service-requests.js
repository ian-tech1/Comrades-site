export function parseFailedUnits(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,;]+/);
  const units = [
    ...new Set(
      raw
        .map((unit) => String(unit).trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
  if (
    !units.length ||
    units.length > 40 ||
    units.some((unit) => unit.length > 120)
  ) {
    throw new Error(
      "Enter between 1 and 40 failed units, each no longer than 120 characters.",
    );
  }
  return units;
}

export function validateReferRequest(input = {}) {
  const institutionName = String(input.institutionName || "")
      .trim()
      .replace(/\s+/g, " "),
    registrationNumber = String(input.registrationNumber || "").trim(),
    admissionNumber = String(input.admissionNumber || "").trim(),
    examPeriod = String(input.examPeriod || "")
      .trim()
      .replace(/\s+/g, " "),
    notes = String(input.notes || "").trim();
  if (institutionName.length < 2 || institutionName.length > 160) {
    throw new Error("Enter an institution name between 2 and 160 characters.");
  }
  if (registrationNumber.length < 2 || registrationNumber.length > 80) {
    throw new Error("Enter a registration number between 2 and 80 characters.");
  }
  if (admissionNumber.length < 2 || admissionNumber.length > 80) {
    throw new Error("Enter an admission number between 2 and 80 characters.");
  }
  if (examPeriod.length < 2 || examPeriod.length > 80) {
    throw new Error("Enter an exam period between 2 and 80 characters.");
  }
  if (notes.length > 1000) {
    throw new Error("Notes must be 1,000 characters or fewer.");
  }
  return {
    institutionName,
    registrationNumber,
    admissionNumber,
    examPeriod,
    failedUnits: parseFailedUnits(input.failedUnits),
    notes,
  };
}

export function detectAvatarMime(input) {
  const bytes = Buffer.from(input || []);
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "";
}
