# Fuel Guard Brand System

Fuel Guard uses a compact semantic colour system so the app feels like one product rather than a collection of generic cards.

## Core Tokens

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Primary fuel colour | `--fg-brand-fuel` | `#f5a623` | Primary actions, fuel progress, suggested fuel times, selected states |
| Primary dark colour | `--fg-brand-dark` | `#101820` | Strong text, header controls, grounding contrast |
| App background | `--fg-brand-bg` | `#f7f1e5` | Warm app canvas |
| Surface colour | `--fg-brand-surface` | `#fffaf0` | Warm card tint and branded empty states |
| Strong surface | `--fg-brand-surface-strong` | `#ffffff` | Main content cards |
| Hydration | `--fg-brand-hydration` | `#0f9faa` | Hydration logs, hydration targets, hydration chart lines |
| Protected | `--fg-brand-protected` | `#1f8a4c` | Steady/protected states and completed rhythm moments |
| Suggested | `--fg-brand-suggested` | `#f5a623` | Upcoming fuel suggestions and fuel-window markers |
| Urgent fuelling | `--fg-brand-urgent` | `#e86f19` | Eat soon / eat now states |
| Critical support | `--fg-brand-critical` | `#c93d2b` | Recovery needed, missed or critical states |
| Secondary neutral | `--fg-brand-neutral` | `#687481` | Inactive labels, secondary data, quiet states |
| Work demand | `--fg-brand-work` | `#4f46e5` | Work shifts and work-demand timeline markers |
| Training demand | `--fg-brand-training` | `#8b5cf6` | Training sessions and previous-period chart comparison |

## Usage Rules

- Fuel information should use the primary fuel colour.
- Hydration information should use the hydration colour.
- Urgency colours are reserved for status, missed windows, or recovery-support moments.
- Selected navigation, subtabs, and primary actions use the Fuel Guard fuel/protected pairing.
- Cards use a small set of variants: primary status, action, planning, summary/history, and insight/trend.
- Empty states use lightweight Fuel Guard guidance, not generic placeholder copy.
- Colour should support meaning but never replace clear text labels.
