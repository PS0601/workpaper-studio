# Security boundaries

## Implemented in the server edition

Server-side role checks use the session actor rather than trusting submitted role fields. Sessions use random tokens and HttpOnly, SameSite=Strict cookies; HTTPS deployments behind a correctly configured proxy set Secure. Requests require a same-origin custom header; supplied Origin headers are checked. Static routing exposes only the application assets, not the source packet, database or server source. Payload and attachment sizes are bounded. Returned narrative text is HTML-escaped. The application makes no outside runtime API calls.

Sensitive identifiers are masked in response objects and source narratives unless a cleared actor explicitly requests a logged reveal. Client views omit internal notes, decisions, selected internal documents and the full audit/approval workpaper. Role switching resets a reveal. Client-facing adjustment records omit internal reasons and source references.

SQLite writes use transactions and workspace revisions. Audit rows have a chained SHA-256 digest and SQL triggers reject update/delete. Frozen rows have SHA-256 fingerprints and update/delete protection. A database administrator can still replace or modify a database by changing schema or files: this is tamper-evidence, not hardware-backed or independently witnessed immutability.

## Not production authentication

The demonstration role switcher lets a person choose any assessment actor. The optional deployment access code is shared admission to the demo, not proof that the person is Priya, Daniel or either client. Do not use this design for real taxpayer data. Production would require identity federation or individual accounts, MFA, engagement-scoped authorization, stronger session lifecycle management, access reviews and a protected administrative control plane.

The server's raw packet and SQLite records are not encrypted by this application. Use host encryption, proper key management, TLS and protected backups before real use. Actor-level sensitive views are logged, but this is not a complete legal privacy/compliance control set.

## Portable edition

The HTML includes the original packet. UI masking in portable mode protects a presentation, not the underlying source. Anyone with the file can inspect it. Browser backups contain internal work and may contain unmasked fictional data. Treat them accordingly. Local storage is neither multi-device collaboration nor a substitute for a server database.

## Other boundaries

No real emails, legal e-signatures, electronic return submissions, agency payment transfers or tax-authority responses occur. Filing events are labeled simulations. The application does not certify tax correctness, completeness of error detection, regulatory compliance or suitability for production. Use the supplied fictional household for evaluation only.
