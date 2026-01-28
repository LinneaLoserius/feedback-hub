# Feedback Hub

Feedback Hub is a lightweight product feedback aggregation and analysis dashboard built on the Cloudflare Developer Platform. It helps product teams turn noisy, unstructured feedback into prioritised, actionable insights using AI.

This project was built as a prototype to explore how Cloudflare Workers can be used to rapidly iterate on product ideas with minimal infrastructure and fast deployment.

**Live Demo**

https://feedback-hub.loserius127.workers.dev

**Quick demo flow:**

Open / to view aggregated insights and urgent issues

Open /submit to add new feedback

Refresh / to see the feedback appear with AI-generated analysis

**Features**

Feedback Hub collects feedback from multiple mocked sources such as Support, Discord, GitHub, Email, Twitter/X, and Forums. On ingestion, AI is used to extract structured signals including theme, sentiment, urgency score (0–100), and a short summary. Both the raw feedback and AI-derived fields are stored to support fast aggregation and prioritisation.

The dashboard-style UI is designed for quick triage and includes KPI cards (feedback volume, sentiment mix, average urgency), top themes, sentiment breakdown, most urgent feedback, and a recent feedback stream. Admin utilities are included for seeding mock feedback and backfilling AI analysis during prototyping.

**Architecture**

Feedback Hub is built entirely using Cloudflare primitives.

Cloudflare Workers host the application and serve both the server-rendered dashboard UI and API endpoints.

Cloudflare D1 is used as the primary datastore, storing feedback records along with AI-derived fields. SQL aggregation queries power the dashboard views (top themes, sentiment breakdown, urgency ranking).

Cloudflare Workers AI is used to transform unstructured feedback text into structured signals at ingest time. These AI-derived fields are persisted in D1 so the dashboard can run fast queries without recomputing analysis on every request.

**Routes**

/
Dashboard with aggregated insights and prioritised feedback

/submit
Simple feedback submission form (mock intake)

/api/feedback
JSON API for feedback ingestion

/admin/seed?token=dev
Seed mock feedback (development only)

/admin/analyze_all?token=dev
Backfill AI analysis for existing feedback (development only)

Note: Admin routes are included for prototyping and demos. In a production environment, these would be restricted or removed.

**Local Development**

Install dependencies and start the development server:

npm install
npm run dev


**The app will be available at:**

http://localhost:8789

**Deployment**

Deploy the application to Cloudflare Workers:

npx wrangler deploy

**Mock Data**

This prototype uses mock data only. No real third-party integrations are required. Feedback can be generated via the submit page or through the development-only seed endpoint.

**Why this project**

This project focuses on fast iteration, clear feedback triage, and turning qualitative input into quantitative signals. It demonstrates how Cloudflare Workers, D1, and Workers AI can be combined to quickly build PM-facing tools with minimal infrastructure overhead.
