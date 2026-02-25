# Future Improvements: nanobrain

This document outlines the roadmap for future enhancements, architectural upgrades, and experimental features for the nanobrain project. These improvements aim to make the agent smarter, safer, and more user-friendly. Consider implementing this **only when user asks**.

## 1. Advanced Memory Mechanism (Inspired by Letta)
Currently, memory consolidation is a basic merge of same-day episodes. Moving forward, we aim to implement a more sophisticated, tiered memory architecture inspired by systems like Letta (formerly MemGPT).

* **Sleep/Dream Cycles (Background Processing):** Introduce an asynchronous "sleep" phase where the agent processes the day's interactions without user blocking. During this phase, the agent can perform deep consolidation, extract higher-level behavioral patterns, and form new insights that wouldn't be possible during rapid conversational turns.
* **Tiered Memory Shifting:** Automatically shift memories between "Working Context" (Main Memory) and "Archival Storage" based on semantic relevance and access frequency, rather than just simple chronological pruning.
* **Relationship & Knowledge Graph Extraction:** Upgrade from flat Markdown files and tags to extracting structured nodes and edges, allowing the agent to understand complex relationships (e.g., "Project A depends on Framework B, which the user dislikes").

## 2. Refined Context & Credit System
* **Multi-dimensional Decay Rates:** Replace the global `decay_rate`. Different memory types should have different half-lives. Core entities (user preferences, system configurations) should decay extremely slowly, while specific episodic summaries (debugging a minor error) should decay much faster.
* **Accurate Token Counting:** Replace the heuristic `content.length / 4` token estimation with precise tokenizers (like `tiktoken` or model-specific SDKs) to maximize the use of the `context_budget` without risking context window overflow.
* **Semantic Contradiction Detection:** Upgrade the heuristic-based contradiction detection (which relies on negation words) to a lightweight LLM-in-the-loop or local embedding approach. This will accurately detect when a new memory conceptually overwrites or conflicts with an old one.

## 3. Safety, Alignment & Sandboxing
As the agent gains autonomy (especially in Branch B where it can self-modify code), safety guardrails become critical.

* **Execution Constraints:** Implement strict permission boundaries within the OpenCode Docker environment to prevent catastrophic actions (e.g., blocking `rm -rf /` or restricting access to specific sensitive directories).
* **Prompt Injection Defenses:** Since the agent can search the web and read external files, it is vulnerable to indirect prompt injection. We need input sanitization or a lightweight local classifier to filter external context before it enters the LLM's prompt.
* **Alignment Monitoring:** For Branch B (self-modification), introduce an automated test suite that runs *before* the agent's code changes are git-committed. If the agent's new memory strategy degrades its performance on benchmark tasks, the commit is automatically rejected.

## 4. Chat from Phones
* **Vercel Chat SDK** supports your agent tool to link discord, slack, github, etc.
