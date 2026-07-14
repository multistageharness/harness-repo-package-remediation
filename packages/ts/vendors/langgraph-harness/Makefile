# langgraph-langchain-harness — command layer. Run from this directory.

.PHONY: install test test-sdk test-backend test-cli test-frontend run-examples serve dev build docs verify clean

install:
	npm install

test:
	npm test

test-sdk:
	npm run test:sdk

test-backend:
	npm run test:backend

test-cli:
	npm run test:cli

test-frontend:
	npm run test:frontend

# compile + run every example flow under mock (offline acceptance contract)
run-examples:
	node sdk/tools/run-examples.mjs

# run ONE flow: make run FLOW=linear-rag ARGS="--events"
run:
	node cli/src/main.mjs run $(FLOW) $(ARGS)

# backend on :7100 (serves the built frontend when dist exists)
serve:
	npm run serve

# frontend dev server on :7101 (proxies /api to :7100)
dev:
	npm run dev -w frontend

build:
	npm run build

docs:
	node sdk/tools/docgen.mjs

# the full gate: every workspace's tests + the example acceptance sweep + docs freshness
verify: test run-examples docs
	@echo "verify: all green"

clean:
	node -e "for (const d of ['.runs','frontend/dist']) require('node:fs').rmSync(d, {recursive: true, force: true})"
