# Ginco

Supplier, invoice and price-comparison app for food retail and wholesale.

- Scan an invoice or delivery note with your phone camera; Gemini reads it; you check and save.
- Speak or type an order ("Ordered 20 kg basmati from Ali Foods at £1.20 a kilo") in English, Hindi or Punjabi.
- See the cheapest supplier for every product, with full price history.
- Manage suppliers, products, invoices and orders.

## Parts

| Part | Where |
|---|---|
| Web app (static, no build step) | `index.html`, `app.js`, `styles.css`, `config.js` |
| Database, security and save functions | Supabase project **BusinessOS**, migration in `supabase/migrations/` |
| AI reader (Gemini) | Supabase edge function `ginco-extract` in `supabase/functions/` |
| Hosting | Vercel (static) |

## Running locally

Any static server works, e.g. `python3 -m http.server 8080` then open http://localhost:8080.

## Secrets

The only secret is `GEMINI_API_KEY`, stored in Supabase → Edge Functions → Secrets. Nothing secret lives in this repo; `config.js` holds the public Supabase URL and publishable key, which are protected by row-level security.
