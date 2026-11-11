# OrderFlow AI roadmap

## Done
- [x] v1 prototype: dashboard, orders, AI investigation, approval workflow, activity log, PayPal settings (demo mode)

## Upgrade (hackathon brief, Nov 11)
- [ ] Merchant auth: login, register, logout, protected routes, per-merchant data isolation
- [ ] "Try Demo" account that only sees labelled sample data
- [ ] Dashboard copy: "Your payment is complete. Is your order?" + demo vs Sandbox labelling
- [ ] Inventory (products) and Suppliers pages; orders linked to products/suppliers
- [ ] Real PayPal Sandbox: OAuth test connection with Disconnected/Connecting/Connected/Failed states
- [ ] PayPal order creation, buyer approval, server-side capture + verification, store transaction IDs
- [ ] PayPal webhook route with signature verification + idempotent event processing
- [ ] Payment columns writable only by the server (invalid info can't mark paid)
- [ ] AI investigation: root cause, business impact, evidence sufficiency, shortage maths
- [ ] Approve / Reject / Mark resolved, all logged
- [ ] AI Insights page
- [ ] Demo scenario: 10 headphones ordered, 4 in stock, supplier pending
- [ ] Tests for new rules, end-to-end browser check, final report

## Blocked / needs user
- PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not found in secrets (requested)
- PAYPAL_WEBHOOK_ID needed after webhook is registered in PayPal dashboard
