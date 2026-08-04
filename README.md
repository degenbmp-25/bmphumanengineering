# BMP Human Engineering

Production website for https://bmphumanengineering.com.

## Publishing workflow

- Pushes to `main` deploy automatically to production through Vercel.
- Other branches and pull requests receive Vercel preview deployments.
- The site is static HTML; no build step is required.

## Lead capture

The current HTML defines `AUDIT_WEBHOOK_URL` as an empty string. Configure a lead-capture endpoint before treating the audit and application forms as production-ready.
