# Production launch checklist

Go/no-go list for the first commercial launch. Engineering items link to
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md); the existing operational release checklist in
`docs/DEPLOYMENT_GUIDE.md §7` still applies and is included by reference (§5).

**Nothing in this repository establishes legal compliance.** Code inspection can show what the software does
(for example, that it can export and delete a user's data); only qualified counsel in each country can say whether
that meets the law. Section 4 lists questions, not answers.

## 1. Owner decisions (business)

| ID | Decision | Why it blocks | Status |
| --- | --- | --- | --- |
| D-1 | Where the operating company is registered, and in which countries it will invoice | Tax registration, e-invoicing, payment provider eligibility, contracts | Open (B-3) |
| D-2 | Launch countries and order (Egypt first? KSA/UAE at launch or later?) | Hosting region, currencies, legal workstreams, catalogue content | Open |
| D-3 | Billing model per country: currencies, prices, monthly/yearly, one Paymob account per country or another provider in the Gulf | Phase 3/5 design | Open |
| D-4 | Hosting region and provider (after L-1/L-2) | Data residency, latency, cost | Open (B-4) |
| D-5 | Whether student accounts and the classroom portal are part of the launch, and how they are priced | Legal scope (minors' data) | Open (B-9) |
| D-6 | AI: who pays, allowance per plan, platform monthly cap, model | Cost control before any school is enabled | Provider chosen (Gemini, 2026-10-28); rest open (B-10) |
| D-7 | Support model: hours, languages, response targets, who holds platform-admin accounts | Terms of service, on-call | Open |
| D-8 | Refund and cancellation policy | Terms, Paymob setup | Open |
| D-9 | Catalogue verification owner (0 of 231 subjects verified) and source policy for other countries | Product liability | Open (B-6) |
| D-10 | Relationship with the separate Wise EduAgent AI Studio app (merge, link, or keep separate) | Scope and data flows | Open (B-8) |

## 2. Credentials and accounts needed

Store each in a password manager and as environment secrets on the host only; never in chat, tickets or the
repository.

| ID | Credential / account | Used by | Env variable(s) |
| --- | --- | --- | --- |
| C-1 | VPS provider account (staging + production), SSH keys | Hosting | — |
| C-2 | Domain and DNS (A/AAAA, SPF, DKIM, DMARC records) | Caddy TLS, email | `DOMAIN`, `ACME_EMAIL`, `APP_URL` |
| C-3 | Paymob merchant account(s): test keys now, live keys after merchant verification; integration ids per method | Billing | `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_IDS` |
| C-4 | Transactional SMTP provider | Email | `SMTP_URL`, `EMAIL_FROM`, `SALES_EMAIL` |
| C-5 | AI provider paid-tier API key, with a console spend limit | AI | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` |
| C-6 | Off-site backup bucket (S3-compatible) or SFTP target, at a different provider | Backups | `.env.backup` (`ops/midad.sh`) |
| C-7 | Backup passphrase | Backups | `MIDAD_BACKUP_PASSPHRASE` |
| C-8 | Generated secrets: `SESSION_SECRET` (48 bytes), `DATA_ENCRYPTION_KEY` (32 bytes), DB passwords | App | see `.env.docker.example` |
| C-9 | Alert channel (email list and/or Slack/Teams webhook) | Alerts | `ALERT_EMAILS`, `ALERT_WEBHOOK_URL` |
| C-10 | Uptime monitor and log service accounts | Monitoring | — |
| C-11 | GitHub billing fixed so Actions run (done 2026-11-01); container registry (GHCR) access | CI/CD | — |
| C-12 | Penetration-testing vendor | Assurance | — |

## 3. Engineering go/no-go

| # | Item | Roadmap | ✓ |
| --- | --- | --- | --- |
| E-1 | Tenant isolation hardening merged (RLS on all tenant tables, web role cannot bypass) | 1.1 | ☐ |
| E-2 | Rollback drill passes on staging with a migration in the release | 1.2, 2.7 | ☐ |
| E-3 | Lockout cannot be used to lock out students or teachers | 1.3 | ☐ |
| E-4 | Container limits and PostgreSQL tuning; no OOM during staging load test | 1.4, 2.6 | ☐ |
| E-5 | Secrets split per service; env file root-only; rotation runbook | 1.5 | ☐ |
| E-6 | CI green on GitHub-hosted runners on the release commit | C-11 | ☐ |
| E-7 | Staging on the same hardware class, deployed from registry images by digest | 2.1–2.3 | ☐ |
| E-8 | External uptime check, host metrics, log shipping, backup alerts | 2.4 | ☐ |
| E-9 | Daily encrypted off-site backup; restore drill on a fresh VM within RTO; RPO agreed | 2.5 | ☐ |
| E-10 | Paymob test-mode run recorded; reconciliation job live; refund/void path | P-1, P-3, P-4 | ☐ |
| E-11 | AI: provider console cap, platform cap in app, timeouts reduced (only if AI is enabled for any school) | AI-1–AI-3 | ☐ |
| E-12 | External penetration test; no open High findings | 6.2 | ☐ |
| E-13 | Arabic copy reviewed by a native editor; screen-reader review (`docs/SCREEN_READER_REVIEW.md`) | 5.4 | ☐ |

## 4. Legal and compliance questions for professional review

To be answered by counsel qualified in each launch country (and an accountant for tax). Listed so nothing is
missed; this document takes no position on the answers.

### 4.1 All countries

1. Is the platform a controller or a processor for school data? What must the contract with each school (DPA)
   contain? Who answers data-subject requests from students and parents?
2. Lawful basis and consent for **minors' data** (student accounts, homework, marks, test monitoring signals):
   whose consent, how it is collected and recorded, and whether schools can give it on parents' behalf.
3. Is the online-test monitoring (page left, pasted length, other device; `docs/ONLINE_TESTS.md §9`) permitted, and
   with what notice?
4. Cross-border transfer: may school data be hosted outside the country? Under which mechanism? Does the answer
   differ for staff data, student data, and backups?
5. Sending school content to an AI provider outside the region: permitted? Required terms (no training, retention,
   region)? Must schools opt in?
6. Breach notification duties and deadlines; who must be notified.
7. Retention: how long may invoices, audit logs (default 730 days, `src/config.ts:51`), AI usage logs (400 days)
   and backups be kept, and what must be deleted when a school leaves?
8. Consumer/e-commerce rules for online subscriptions: cancellation, refunds, auto-renewal notices, Arabic-language
   requirements for terms and invoices.
9. Payment: PCI DSS scope with hosted checkout and saved-card tokens (confirm SAQ type with Paymob).

### 4.2 Egypt

10. Personal Data Protection Law No. 151 of 2020 and its Executive Regulations: licensing or registration for
    controllers/processors and for cross-border transfer; the grace period noted in `SECURITY_DESIGN.md §7` ends
    around 31 October–1 November 2026 **[DOC]**, so status today must be checked.
11. VAT registration (resident or non-resident simplified regime) and Egyptian Tax Authority e-invoicing/e-receipt
    obligations.
12. Any Ministry of Education rules on platforms used by schools or on student data.

### 4.3 Saudi Arabia

13. Personal Data Protection Law (SDAIA) and its implementing and transfer regulations: registration, DPO,
    cross-border transfer conditions, whether education data must stay in the Kingdom.
14. VAT registration and ZATCA e-invoicing (Fatoora) obligations for a resident or non-resident supplier.
15. Any NCA cybersecurity controls or Ministry of Education requirements that apply to SaaS used by schools.

### 4.4 United Arab Emirates

16. Federal Decree-Law No. 45 of 2021 (PDPL) and whether customers in free zones (DIFC, ADGM) bring separate
    regimes; cross-border transfer rules.
17. VAT registration for a foreign supplier of digital services; invoice requirements.
18. Emirate-level education regulator requirements (e.g. for private schools) on student data.

### 4.5 Other Arab countries

19. For each additional country: data-protection law in force, transfer rules, tax on digital services, and whether
    Paymob or another provider can collect payments there.

## 5. Launch-day runbook (summary)

1. Freeze `main`; tag the release; CI green; image pushed and digest recorded.
2. Backup and verified restore of production (empty or pilot data).
3. `DEPLOYMENT_GUIDE.md §7` checklist, every line.
4. Deploy; `/readyz` 200 on both instances; sign-up → verify → login with real email; test alert received.
5. One real low-value payment and refund in each launch currency.
6. Platform admin created with TOTP; demo data absent; student features off unless D-5 and counsel allow.
7. Privacy notice, terms, support contact live in Arabic and English.
8. Watch for 48 hours: error alerts, payment webhooks, backups, disk.

## 6. Verification commands

```bash
curl -fsS https://$DOMAIN/readyz
curl -sI https://$DOMAIN/ | grep -iE "strict-transport|content-security"
npm run paymob:check     # with the environment's Paymob keys
npm run ai:check         # only if AI is enabled
ops/status.sh --env prod
ops/backup.sh --env prod && ops/restore.sh --env prod --only-verify
```
