# Your Questions, Answered (Simple Language)

*Written on 14 August 2026, based on the actual code and setup docs in this project
(`docs/deployment.md`, `docs/remaining-work-plan.md`, `CHANGES.md`).*

---

## Q1. Does the website have everything — full e-commerce, admin panel, database, etc.?

Short answer: **The website itself (the software) is basically finished. Putting it
"live" on the internet with your own domain has NOT been done yet.**

Here is each item you asked about, one by one:

| Feature | Status | Simple explanation |
|---|---|---|
| Full e-commerce website | ✅ Done | Customer can browse products, search, add to cart, checkout, and pay. |
| Admin panel | ✅ Done | 7 screens for you to run the shop: products, categories, orders, delivery slots, pincodes, settings, dashboard. |
| Database | ✅ Done | All products, orders, customers, stock etc. are stored properly (Postgres database). |
| Product / category management | ✅ Done | You can add, edit, upload photos for products and categories from the admin panel. |
| Price & stock management | ✅ Done | You can set prices per item, and stock quantity goes down automatically when an order is confirmed. |
| Order management | ✅ Done | Orders move through stages (placed → confirmed → packed → delivered), with a printable packing slip. |
| Customer management | ✅ Done | Customers log in with Google or phone number, and their saved addresses are stored. |
| Cart & checkout | ✅ Done | Fully working, tested with a real order end-to-end. |
| Delivery slots | ✅ Done | You can set delivery time slots and how many orders each slot can take. |
| Payment: COD | ✅ Done | Cash-on-delivery works fully right now, with an OTP to confirm the order. |
| Payment: Online (cards/UPI) | ⚠️ Built, but not switched on | The code for online payment (via Razorpay) is ready. It just needs your Razorpay account to be verified (KYC) and real keys entered — then it can be turned on anytime, even after launch. |
| WhatsApp for orders | ⚠️ Partly done | Customer can send their cart to your WhatsApp automatically. WhatsApp is also used to send OTP codes and to alert you ("owner") when a new order comes in — but this needs your WhatsApp Business account to be approved by Meta (Facebook) first. |
| "Call to order" button | ✅ Done | A floating button on every page (bottom-right) that lets a customer either call the shop directly, or open WhatsApp with their basket already written out. Built and checked in a real browser on 14 August 2026. |
| Mobile & desktop responsive design | ⚠️ Mostly done, not fully checked | The site is built to resize for phone and desktop, but it has not been carefully tested/adjusted on real phones yet (this is a pending task). Also, the current look is a **placeholder design** — your final design is meant to be applied on top of this working backend. |
| SSL (the padlock/https on your site) | ❌ Not live yet | Not a cost or coding problem — it turns on automatically for free the moment the site is put on a real server with a domain. Right now there's no live server, so there's nothing to put a padlock on yet. |
| Hosting (where the website "lives" online) | ❌ Not set up yet | The plan is written and ready (a free-tier cloud server), but it has not actually been created/set up yet. |
| 2-year domain (your website address, e.g. shopname.in) | ❌ Not included | Nobody has bought a domain name yet. This has to be purchased separately (see cost answer below). |
| Deployment (making it "go live") | ❌ Not done | The last step — putting everything on the internet — has not happened yet. |
| Basic SEO (so you show up on Google) | ⚠️ Very basic only | Page titles/descriptions exist on some pages. Proper SEO (sitemap, Google-friendly setup, social share images) is planned but not done yet. |

**In plain words:** think of it like a fully built shop with shelves stocked,
staff trained, and the cash counter working — but it's still sitting inside a
warehouse. It hasn't been moved to its actual street address (domain) and the
signboard/shutters (SSL, hosting, final design) aren't up yet. A few things also
need YOU personally to provide before it can open:

- Product photos
- A verified WhatsApp Business account (with a payment method added) — this is what lets the site *send* messages: OTP codes and your new-order alerts
- **The shop's WhatsApp order number(s)** — a separate, simpler thing from the account above: just the phone number customers reach when they tap a "WhatsApp" button. There are two places this lives:
  - The **"Order on WhatsApp" buttons** on the home page, product pages, and cart page read this from `/admin/settings` in the admin panel — no approval needed, you (or I) just type the number in and it updates instantly. Until it's entered, those buttons show a placeholder number
  - The **floating call/WhatsApp button** (bottom-right, on every page) and the "call the shop" fallback on the login page use a different setting — one that's configured when the site is deployed to a live server, not from the admin panel. This one just needs to be given to whoever deploys the site (me, currently)
- A verified Razorpay account (only needed if you want online payment, not COD)
- Your shop's exact location (for the 5 km delivery radius)
- A domain name of your choice

---

## Q2. What will it cost me monthly/yearly to run this website?

Good news: the way this project is built, the **running cost is designed to be
close to ₹0 per month**, except for a couple of small, unavoidable items. Here's
the honest breakdown:

| Item | Cost | Notes |
|---|---|---|
| Website hosting (server) | **₹0/month** | Uses a cloud server's permanent free plan (Oracle Cloud "Always Free"). As long as your traffic stays within normal limits for a local shop, this stays free forever. |
| Database (storage for orders/products) | **₹0/month** | Runs on the same free server, no separate charge. |
| SSL certificate (https padlock) | **₹0/month** | Free and automatic (via Cloudflare + Let's Encrypt). |
| Domain name (your website address) | **Not included — you pay this** | Roughly ₹500–₹1,500 per year depending on the domain type (`.in`, `.com`, etc.) and where you buy it. For 2 years, expect roughly ₹1,000–₹3,000 total, paid to a domain seller like GoDaddy/Namecheap/BigRock — this is not part of the website build, it's a separate purchase you make. |
| WhatsApp messages (OTP codes + your order alerts) | **~₹0.14 per message** | Very small. Example: even 300 orders in a month ≈ roughly ₹80–₹100 total. Scales with how many orders/OTPs you actually get. |
| Online payments (Razorpay) | **No monthly fee — pay only per online transaction** | About 2% + GST is deducted only when a customer pays online (card/UPI/etc). Cash-on-delivery orders cost nothing here. |
| Product photo storage (Cloudinary) | **₹0 to start** | Free plan is normally enough for a shop's product photos. If the shop grows very large with huge traffic, a paid plan may eventually be needed — but not at the start. |
| Backups | **₹0** | Free-tier cloud storage is enough for nightly backups at this scale. |
| Site monitoring (alerts if site goes down) | **₹0** | Free tool (UptimeRobot) can be used. |

### Bottom line
- **Fixed monthly cost: practically ₹0.**
- **Yearly cost: mainly just the domain renewal** (~₹500–₹1,500/year depending on domain choice).
- **Variable costs**: a few paise per WhatsApp message, and ~2% + GST only on orders customers pay online (not on cash orders).

**One honest caution:** these are all "free tier" services from big companies
(Oracle, Cloudflare, Cloudinary, etc). Free tiers are generous and meant to last,
but if the shop becomes very large (huge traffic, thousands of orders/photos),
some of these may eventually need a small paid upgrade. For a single local shop
starting out, ₹0/month + domain renewal is a realistic expectation.

---

*If anything here doesn't match what you were told separately (e.g. about domain,
hosting, or who is buying what), it's worth double-checking with whoever is
managing the project, since this file only reflects what's written in the
project's own setup documents.*
