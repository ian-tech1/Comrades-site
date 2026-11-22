export function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isValidUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeUsername(value));
}

export function parseRegisteredUnits(value) {
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
      "Enter between 1 and 40 registered units, each no longer than 120 characters.",
    );
  }
  return units;
}

export function validateResultsRequest(input = {}) {
  const institutionName = String(input.institutionName || "")
    .trim()
    .replace(/\s+/g, " ");
  const registrationNumber = String(input.registrationNumber || "").trim();
  const admissionNumber = String(input.admissionNumber || "").trim();
  if (institutionName.length < 2 || institutionName.length > 160) {
    throw new Error("Enter an institution name between 2 and 160 characters.");
  }
  if (registrationNumber.length < 2 || registrationNumber.length > 80) {
    throw new Error("Enter a registration number between 2 and 80 characters.");
  }
  if (admissionNumber.length < 2 || admissionNumber.length > 80) {
    throw new Error("Enter an admission number between 2 and 80 characters.");
  }
  return {
    institutionName,
    registrationNumber,
    admissionNumber,
    registeredUnits: parseRegisteredUnits(input.registeredUnits),
  };
}
