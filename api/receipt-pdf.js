function printable(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (char) => `\\${char}`);
}

function wrap(line, width = 82) {
  const words = String(line).split(/\s+/).filter(Boolean);
  const rows = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word.slice(0, width);
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      rows.push(current);
      current = word.slice(0, width);
    }
  }
  if (current) rows.push(current);
  return rows.length ? rows : [""];
}

export function createReceiptPdf(receipt) {
  const rows = [
    receipt.portalName || "Comreds Papers Portal",
    "PAYMENT RECEIPT",
    "",
    `Receipt number: ${receipt.receipt || "Not available"}`,
    `Payment status: ${receipt.status || "Confirmed"}`,
    `Service: ${receipt.service || "Portal service"}`,
    `Request reference: ${receipt.requestReference || "Not supplied"}`,
    `Amount received: KSh ${Number(receipt.amount || 0).toLocaleString("en-KE")}`,
    `Transaction time: ${receipt.paidAt || "Not supplied"}`,
    `Time source: ${receipt.paidAtSource || "Unavailable"}`,
    "",
    `Registered learner: ${receipt.studentName || "Not supplied"}`,
    `Username: ${receipt.username || "Not supplied"}`,
    `Account email: ${receipt.email || "Not supplied"}`,
    `Registered phone: ${receipt.registeredPhone || "Not supplied"}`,
    `Actual payer name: ${receipt.payerName || "Not supplied by M-Pesa"}`,
    `Payer name source: ${receipt.payerNameSource || "Unavailable"}`,
    `Actual payer phone: ${receipt.paidPhone || "Not supplied"}`,
    `Confirmation method: ${receipt.confirmationSource || "Not supplied"}`,
    "",
    "This receipt records a payment confirmed by the Comreds portal.",
  ].flatMap((line) => wrap(line));

  const commands = ["BT", "/F1 11 Tf", "50 790 Td", "15 TL"];
  rows.forEach((line, index) => {
    if (index) commands.push("T*");
    if (index === 0) commands.push("/F1 16 Tf");
    if (index === 1) commands.push("/F1 13 Tf");
    if (index === 2) commands.push("/F1 11 Tf");
    commands.push(`(${printable(line)}) Tj`);
  });
  commands.push("ET");
  const stream = `${commands.join("\n")}\n`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ];
  let document = "%PDF-1.4\n%COMREDS\n";
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
