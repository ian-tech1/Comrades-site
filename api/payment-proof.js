export function isValidMpesaConfirmation({
  resultCode,
  amount,
  expectedAmount,
  payerPhone,
  expectedPhone,
  receipt,
}) {
  const normalize = (value) => {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  };

  return (
    Number(resultCode) === 0 &&
    typeof receipt === "string" &&
    /^[A-Z0-9]{8,12}$/i.test(receipt) &&
    Number.isFinite(Number(amount)) &&
    Number(amount) === Number(expectedAmount) &&
    /^254\d{9}$/.test(normalize(payerPhone)) &&
    normalize(payerPhone) === normalize(expectedPhone)
  );
}
