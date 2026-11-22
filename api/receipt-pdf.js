function printable(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[·•–—−]/g, "-")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (char) => `\\${char}`);
}

function wrap(value, width = 56) {
  const words = String(value ?? "Not supplied")
    .split(/\s+/)
    .filter(Boolean);
  const rows = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) rows.push(current);
      current = "";
      for (let offset = 0; offset < word.length; offset += width)
        rows.push(word.slice(offset, offset + width));
    } else if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      rows.push(current);
      current = word;
    }
  }
  if (current) rows.push(current);
  return rows.length ? rows : ["Not supplied"];
}

const ink = "0.08 0.15 0.27",
  muted = "0.38 0.45 0.55",
  navy = "0.04 0.11 0.22",
  teal = "0.02 0.57 0.51",
  light = "0.94 0.97 0.99",
  green = "0.05 0.48 0.31";

function text(commands, x, y, size, value, font = "F1", color = ink) {
  commands.push(
    `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${printable(value)}) Tj ET`,
  );
}

function rect(commands, x, y, width, height, color) {
  commands.push(`q ${color} rg ${x} ${y} ${width} ${height} re f Q`);
}

function line(commands, x1, y1, x2, y2, color = "0.86 0.89 0.93", width = 0.7) {
  commands.push(`q ${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q`);
}

function money(value) {
  const amount = Number(value || 0);
  return `KSh ${Number.isFinite(amount) ? amount.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : "0"}`;
}

export function createReceiptPdf(receipt) {
  const portalName = String(receipt.portalName || "Comreds Papers Portal")
    .toUpperCase()
    .slice(0, 34);
  const pages = [];
  let commands = [];
  let y = 0;

  function beginPage(continued = false) {
    commands = [];
    rect(commands, 0, 0, 595, 842, "1 1 1");
    rect(commands, 0, 714, 595, continued ? 94 : 128, navy);
    rect(commands, 0, 710, 595, 4, teal);
    text(
      commands,
      48,
      continued ? 771 : 790,
      continued ? 17 : 21,
      portalName,
      "F2",
      "1 1 1",
    );
    text(
      commands,
      48,
      continued ? 746 : 762,
      10,
      continued ? "PAYMENT RECEIPT - CONTINUED" : "PAYMENT RECEIPT",
      "F2",
      "0.68 0.91 0.88",
    );
    text(
      commands,
      48,
      continued ? 727 : 741,
      8.5,
      "Secure digital payment record - Kenya Shillings",
      "F1",
      "0.86 0.91 0.97",
    );

    if (!continued) {
      rect(commands, 42, 603, 511, 86, light);
      rect(commands, 42, 603, 5, 86, teal);
      text(commands, 62, 665, 8, "AMOUNT RECEIVED", "F2", muted);
      text(commands, 62, 628, 25, money(receipt.amount), "F2", navy);
      const statusText = String(receipt.status || "Confirmed").toUpperCase();
      rect(commands, 422, 642, 111, 25, "0.86 0.96 0.91");
      text(commands, 434, 651, 8, statusText.slice(0, 17), "F2", green);
      y = 579;
    } else y = 681;
  }

  function finishPage() {
    text(
      commands,
      48,
      38,
      8,
      "Keep this receipt for your records. Payment evidence and identity sources are shown as recorded by the portal.",
      "F1",
      muted,
    );
    line(commands, 48, 55, 547, 55, "0.86 0.89 0.93", 0.7);
    pages.push(commands.join("\n") + "\n");
  }

  function ensureSpace(height) {
    if (y - height < 74) {
      finishPage();
      beginPage(true);
    }
  }

  function section(title, entries) {
    ensureSpace(35);
    line(commands, 48, y, 547, y, "0.82 0.87 0.92", 0.8);
    y -= 19;
    text(commands, 48, y, 9, title.toUpperCase(), "F2", teal);
    y -= 16;

    for (const [label, value] of entries) {
      const rows = wrap(value);
      const rowHeight = Math.max(21, rows.length * 12 + 6);
      ensureSpace(rowHeight);
      text(commands, 55, y, 8, label, "F2", muted);
      rows.forEach((part, index) =>
        text(commands, 190, y - index * 12, 9.5, part, "F1", ink),
      );
      y -= rowHeight;
      line(commands, 190, y + 5, 547, y + 5, "0.92 0.94 0.96", 0.45);
    }
    y -= 9;
  }

  beginPage();
  section("Transaction details", [
    ["Receipt number", receipt.receipt || "Not available"],
    ["Service", receipt.service || "Portal service"],
    ["Request reference", receipt.requestReference || "Not supplied"],
    ["Transaction time", receipt.paidAt || "Not supplied"],
    ["Time source", receipt.paidAtSource || "Unavailable"],
    ["Confirmation", receipt.confirmationSource || "Not supplied"],
  ]);
  section("Registered learner account", [
    ["Learner name", receipt.studentName || "Not available in profile"],
    ["Username", receipt.username || "Not supplied"],
    ["Account email", receipt.email || "Not supplied"],
    ["Registered phone", receipt.registeredPhone || "Not supplied"],
  ]);
  if (
    receipt.requestStudentName &&
    receipt.requestStudentName !== receipt.studentName
  )
    section("Request-submitted details", [
      ["Name submitted on request", receipt.requestStudentName],
    ]);
  section("M-Pesa payer evidence", [
    ["Payer name", receipt.payerName || "Not supplied by M-Pesa"],
    ["Name source", receipt.payerNameSource || "Unavailable"],
    ["Payer phone", receipt.paidPhone || "Not supplied"],
  ]);
  finishPage();

  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageRefs = [];
  const firstPageId = 3;
  const fontRegularId = firstPageId + pages.length * 2;
  const fontBoldId = fontRegularId + 1;

  pages.forEach((stream, index) => {
    const pageId = firstPageId + index * 2;
    const streamId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId - 1] =
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;
  objects[fontRegularId - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[fontBoldId - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let document = "%PDF-1.4\n%COMREDS-RECEIPT\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}
