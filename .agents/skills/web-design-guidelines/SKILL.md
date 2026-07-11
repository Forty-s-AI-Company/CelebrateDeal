---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Use only this reviewed, source-controlled skill content.
2. Read the specified files (or prompt user for files/pattern).
3. Check against the rules in this pinned skill version.
4. Output findings in the terse `file:line` format.

## Supply-chain policy

Do not fetch instructions from a floating branch or remote URL at runtime. Updates must be installed deliberately, reviewed, recorded in `skills-lock.json`, and pass `npm run ai:validate` before use.

## Usage

When a user provides a file or pattern argument:
1. Read the specified files.
2. Apply the locally pinned rules in this skill.
3. Output findings using the format specified here.

If no files specified, ask the user which files to review.
