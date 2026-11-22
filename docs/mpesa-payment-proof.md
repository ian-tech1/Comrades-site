# M-Pesa payment proof notes

## Callback data and payer name

The inspected Daraja STK Push integration guide shows a successful `Body.stkCallback` with `ResultCode: 0` and `CallbackMetadata.Item` entries named `Amount`, `MpesaReceiptNumber`, `TransactionDate`, and `PhoneNumber`. It does not show a payer-name field in that callback example. The implementation therefore treats the callback phone as the actual payer phone, parses `TransactionDate` as East Africa Time (UTC+03:00), and leaves payer name unavailable unless a verified source supplies it. A prompted phone number is not a payer's registered name. [1]

Safaricom's public developer portal identifies M-Pesa Express and Transaction Status as Daraja APIs, but the public pages inspected did not expose detailed response schemas in the rendered content. The portal's API references remain the preferred official starting point for provider-specific contract changes. [2] [3]

## Confirmation and reconciliation

An STK Push request being accepted is not proof that the learner paid. The reviewed guide distinguishes initial request acceptance from the later callback and demonstrates an STK Push Query call by `CheckoutRequestID` for cases where a callback has not arrived. Because the guide does not establish that an STK query response contains the matching receipt, amount, and payer phone, this portal stores query results for review and does not let a query alone unlock a request. A confirmed automatic payment still requires a matching receipt, amount and payer phone from the callback; an administrator may separately record verified M-Pesa evidence with an audit trail. [1]

## References

[1]: https://www.codecapsules.io/blog/mpesa-daraja-api-stk-push-nodejs/ "M-Pesa Daraja API tutorial for STK Push"
[2]: https://developer.safaricom.co.ke/apis/MpesaExpressSimulate "Safaricom M-Pesa Express API"
[3]: https://developer.safaricom.co.ke/apis/TransactionStatus "Safaricom Transaction Status API"
