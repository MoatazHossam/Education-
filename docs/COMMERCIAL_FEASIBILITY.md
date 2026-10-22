# Commercial feasibility

Legend: **[F]** researched fact (source linked; third-party sources may be imperfect),
**[A]** assumption made for this model — replace with real data as it arrives.
Currency: EGP; USD at **52.5 EGP/USD [A]** (mid-October 2026 market level was ~52.4–52.8 [F] —
[rate history](https://www.poundsterlinglive.com/history/USD-EGP-2026)).

## 1. Market assessment

### Context
- Egypt's ed-tech market was reported at about **$875 M in 2025**, with 9 M paid learner accounts
  [F] ([Arab Finance, citing Ken Research](https://arabfinance.com/en/news/newdetails/from-overcrowded-classrooms-to-ai-egypt-edtech-sector-enters-new-era));
  narrower "online education" estimates differ (IMARC: ~$309 M in 2024) [F] ([IMARC](https://www.imarcgroup.com/egypt-online-education-market)).
- The curriculum is in flux: the **Egyptian Bakaloria** reached 99% opt-in for 2026/27, about
  **832k students** [F] ([EnterpriseAM](https://enterpriseam.com/egypt/blackboards/99-of-students-opted-into-egypts-new-baccalaureate-system/)),
  alongside primary/preparatory plan changes and new identity-subject rules for international schools
  (per the original artifact's sources, **not independently verified**).
- **Private schools:** 10,023 in 2025/26 per a CAPMAS-based factsheet, or 8,806 per a government
  figure cited by EnterpriseAM — definitions differ [F] ([Arab Finance](https://www.arabfinance.com/en/news/newdetails/back-to-school-pre-university-education-in-focus),
  [EnterpriseAM](https://enterpriseam.com/egypt/blackboards/egypts-tuition-season-is-the-real-measure-of-the-ministrys-fee-crackdown/)).
  A commercial dataset lists **101 international schools in Cairo** [F] ([WhereNext](https://getwherenext.com/schools/cairo/insights)).
- **Private tutoring** is pervasive (42–60% of secondary students; up to ~75% in the final year per
  a World Bank document) [F] ([Egyptian Streets](https://egyptianstreets.com/2026/04/09/why-private-tutoring-rules-egypts-education/)).
  Market-size figures for tutoring conflict; ~$0.78 B (2024) is the most cited but unverified [F/uncertain].

### Target segments (in order of expected willingness to pay) [A]

| Segment | Pain | Est. reachable organizations in Egypt |
| --- | --- | --- |
| Ed-tech / AI tutoring products (like the original "Paradise EduAgent") | Must define and keep current exactly which curriculum they cover; feed it to content/AI pipelines | 100–300 [A] |
| Content producers & publishers (books, video, question banks) | Production planning per grade/track/edition; Bakaloria transition | 100–300 [A] |
| Tutoring-centre chains | Which subjects/books each centre covers | 300–1,000 multi-branch centres [A] |
| Private & international school groups | Identity subjects, programme mapping across campuses | groups among ~9–10k private schools [F] — perhaps 200–500 groups [A] |
| Curriculum consultants | Client deliverables | 50–150 [A] |

Serviceable market for a paid scoping tool: roughly **850–2,250 organizations [A]**.

### Competition and substitutes

| Alternative | Type | Notes |
| --- | --- | --- |
| Spreadsheets / Google Sheets | Substitute (free) | The main competitor; no maintained catalogue |
| Ministry digital library / Egyptian Knowledge Bank | Free official source | Official textbooks; no commercial references, no team workflow |
| Toddle, Rubicon Atlas | Global curriculum planning/mapping | Quote-based pricing; Atlas priced per student via district deals [F] ([Capterra – Toddle](https://www.capterra.com/p/251547/Toddle/), [MREA – Atlas](https://www.mreavoice.org/?p=388)). Aimed at schools' own curriculum design, not the Egyptian national/commercial catalogue |
| Curriculum Trak, generic curriculum-mapping tools | Global | From ~$300/user/year and ~$20/user listed prices [F] ([Capterra](https://www.capterra.com/p/151350/Curriculum-Trak/)) |
| Nafham, Noon Academy, Edraak and similar | Content platforms | Potential **customers** (they build curriculum-aligned content [F] — IMARC), not direct competitors |

### Differentiation
- Maintained, structured catalogue of the 2026/27 Egyptian system incl. Bakaloria vs Thanaweya Amma,
  language-school variants, common commercial references and international programmes — in one place, bilingual.
- Team workflow with roles and audit trail; exports and an API for pipelines.
- Priced for the Egyptian market, payable in EGP.

### Pain points addressed / adoption challenges
- **Addressed:** fragmented sources, yearly changes, no shared record of decisions.
- **Challenges:**
  1. *Willingness to pay for a list.* The value is the curation; the software is easy to copy. → Invest in data freshness, verification marks and change notifications.
  2. *Trust in accuracy.* Current data cites news articles [F] and is unverified. → Editorial verification against decrees before charging.
  3. *Payment friction.* Card use is limited; wallets/Fawry matter. → Paymob (cards + wallets) and manual invoicing for B2B.
  4. *Small serviceable market* (see sizing). → Expansion to other curricula (KSA, UAE, Jordan) and deeper features (lesson-level mapping, coverage tracking, AI-assisted content planning) for growth beyond ~500 customers.
  5. *Regulation:* PDPL licensing and VAT registration (SECURITY_DESIGN.md §7).

## 2. Pricing strategy

| Plan | Price | Rationale |
| --- | --- | --- |
| Free | EGP 0 | Catalogue + 1 scope + copy list keeps the original artifact's value free; acquisition channel |
| Starter | **EGP 990/mo** (~$19), EGP 9,900/yr | Small teams/centres; below the cost of a few hours of a content coordinator's time per month [A] |
| Professional | **EGP 2,900/mo** (~$55), EGP 29,000/yr | Ed-tech/publishers needing API, CSV/JSON, 25 seats; still far below per-user global tools (5 users of a $300/user/yr tool ≈ $125/mo [F-derived]) |
| Enterprise | from **EGP 10,000/mo [A]**, annual contract | School groups/large publishers: custom limits, invoicing, priority support |

Notes: prices exclude VAT (14% on digital services [F] — [Kintsugi](https://trykintsugi.com/sales-tax-guides/middle-east/egypt));
annual plans give two months free; a 14-day Professional trial lets prospects test the API.
Revisit prices after the first 20 paying customers; consider USD pricing for customers outside Egypt.

## 3. Financial model (monthly, EGP)

### Assumptions [A]
| Item | Value |
| --- | --- |
| Paying-customer mix | Starter 60%, Professional 35%, Enterprise 5% |
| Average revenue per paying account (ARPA) | 0.6×990 + 0.35×2,900 + 0.05×10,000 = 2,109; minus ~5% for annual-plan discounts → **≈ 2,000** |
| Payment processing | 2.75% + EGP 3 per payment ≈ **2.9%** of revenue (Paymob "from 2.75%" per a comparison site [F, unconfirmed]; fixed fee [A]) |
| Infrastructure | 10–100 customers: 1 VM (~€8–15) + managed PostgreSQL (~€15–30) + SMTP + backups storage + domain ≈ **EGP 2,300–3,000**; 500: ≈ **5,000**; 1,000 (2 app nodes, HA database, Redis, paid monitoring): ≈ **12,000**. Hetzner CPX22 €7.99/mo after the April 2026 increase [F] ([Better Stack](https://betterstack.com/community/guides/web-servers/digitalocean-vs-hetzner/)) |
| Support | EGP 25,000 per full-time agent; 0.1 FTE at 10 customers, 0.25 at 50, 0.5 at 100, 2 at 500, 4 at 1,000 |
| Catalogue curation (part of cost of service) | Part-time specialist EGP 20,000 up to 100 customers; 1 FTE (35,000) at 500; 2 FTE (70,000) at 1,000 |
| Engineering (operating expense) | 1 engineer EGP 60,000 up to 100 customers; 2 at 500; 3 at 1,000 |
| Sales & marketing | 15% of revenue, minimum EGP 10,000 |
| General & admin (accounting, legal, tools) | EGP 15,000; 25,000 at 500; 30,000 at 1,000 |

### Scenarios

| Paying customers | 10 | 50 | 100 | 500 | 1,000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **MRR** | 20,000 | 100,000 | 200,000 | 1,000,000 | 2,000,000 |
| ≈ MRR in USD | 381 | 1,905 | 3,810 | 19,048 | 38,095 |
| Infrastructure | 2,300 | 2,500 | 3,000 | 5,000 | 12,000 |
| Payment fees (2.9%) | 580 | 2,900 | 5,800 | 29,000 | 58,000 |
| Support | 2,500 | 6,250 | 12,500 | 50,000 | 100,000 |
| Catalogue curation | 20,000 | 20,000 | 20,000 | 35,000 | 70,000 |
| **Cost of service** | 25,380 | 31,650 | 41,300 | 119,000 | 240,000 |
| **Gross margin** | −27% | 68% | 79% | 88% | 88% |
| Variable cost per customer (fees + support) | 308 | 183 | 183 | 158 | 158 |
| Engineering | 60,000 | 60,000 | 60,000 | 120,000 | 180,000 |
| Sales & marketing | 10,000 | 15,000 | 30,000 | 150,000 | 300,000 |
| G&A | 15,000 | 15,000 | 15,000 | 25,000 | 30,000 |
| **Operating result** | −90,380 | −21,650 | +53,700 | +586,000 | +1,250,000 |

### Break-even
Fixed monthly costs at small scale ≈ infrastructure 2,500 + curation 20,000 + engineering 60,000 +
G&A 15,000 = **97,500**. Contribution per paying customer ≈ ARPA 2,000 − fees 58 − support 125 −
marketing 300 (15% of ARPA) = **≈ 1,517**. Break-even ≈ 97,500 / 1,517 ≈ **64–65 paying
customers** (about **65–75** allowing for support hires coming in steps) — roughly 3–8% of the
estimated serviceable market of 850–2,250 organizations [A].

### Reading the numbers
- Infrastructure is not the constraint (≤ 1% of revenue beyond 100 customers). People are:
  **curation** (product quality) and **support** dominate cost of service.
- At ~100 paying organizations the business is profitable on these assumptions; 500–1,000 likely
  exceeds the Egyptian serviceable market estimate and needs regional expansion or broader features.
- Biggest sensitivities: ARPA (plan mix), churn (not modelled — assume annual contracts to limit it),
  and the cost and speed of keeping the catalogue verified.

## 4. Verdict

Commercially **viable as a focused, low-cost B2B tool** if (1) the catalogue is verified and kept
current, (2) the first customers come from ed-tech and content producers who benefit from the API,
and (3) costs stay lean until ~100 paying organizations. As a standalone product it is a niche;
its stronger position is as the curriculum-scoping module of a broader content-planning offering.
Treat all [A] figures as hypotheses to validate with 10–20 customer interviews before investing in sales.
