.DEFAULT_GOAL := help

.PHONY: help install start test verify lint clean

help: ## List the available commands
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (npm install)
	npm install

# Extra args forwarded to the wizard, e.g.
#   make start FLOW_ARGS="--harness-render-root /tmp/scratch"
# The render path is a parameter (ARG beats ENV beats cwd): with neither set, the
# wizard renders under THIS directory — `harness-repo-package-remediation/.harness/<SESSION_ID>/` — and the
# vendored pack's own tree under `<SESSION_ID>/langgraph-harness-integration/.harness/`.
FLOW_ARGS ?=

start: ## Launch the interactive `flow` wizard (prompt → preview → config → run for real → report)
	node vendors/langgraph-harness-integration/bin/flow.mjs $(FLOW_ARGS)

test: ## Run the test suite (npm test)
	npm test

verify: ## Run the offline verify gate (npm run verify)
	npm run verify

lint: ## Run the linter if configured
	npm run lint --if-present

clean: ## Remove installed node_modules
	rm -rf node_modules packages/*/node_modules
