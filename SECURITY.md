# NIJAKAVACH — Security & Vulnerability Disclosure Policy

## 1. Security Architecture Tenets

NIJAKAVACH is committed to protecting the privacy and personal data of Indian consumers. The platform is designed with security as an immutable foundational requirement:

- **Zero Plaintext PII**: Raw telephone numbers are never stored in plaintext, never written to log files or telemetry streams, and never passed in unencrypted query parameters.
- **Envelope Encryption**: Sensitive attributes are encrypted using AES-256-GCM. Lookups are executed using keyed HMAC-SHA256 digests.
- **Statutory DPDP Alignment**: Complies with the principles of Purpose Limitation, Explicit Consent, Notice, and Right to Correction & Erasure under India's Digital Personal Data Protection Act, 2023 (DPDP Act).
- **Audit Trails**: Security and consent transitions are immutably preserved in a cryptographically chained audit ledger.

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability in NIJAKAVACH, we ask that you report it to our engineering team responsibly.

- **Email**: `security@nijakavach.in`
- **PGP Fingerprint**: `NIJAKAVACH-SECURITY-TEAM-2026-KEY`
- Please do not publicly disclose the vulnerability until our security engineers have investigated and deployed a remediation.

---

## 3. Scope & Permitted Testing

- **In Scope**:
  - API Gateway and public REST endpoints
  - Cryptographic verification logic
  - Consent and authorization workflows
  - Authentication and token lifecycle
- **Strictly Out of Scope**:
  - Denial of Service (DoS/DDoS) attacks against platform infrastructure
  - Automated high-frequency scraping against third-party public directories
  - Social engineering or physical security attacks against staff or data centers
