SHELL := /bin/bash
.DEFAULT_GOAL := help
.ONESHELL:
.SHELLFLAGS := -euo pipefail -c

PKG_MANAGER ?= npm
PORT        ?= 5247
PID_FILE    := .dev.pid
LOG_FILE    := .dev.log

.PHONY: help install clean dev stop up down watch status logs typecheck test check-report

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	$(PKG_MANAGER) install

clean: stop ## Remove build artifacts and logs
	rm -rf dist .vite $(LOG_FILE) $(PID_FILE)

dev: stop ## Start the vite dev server in the background
	@echo "starting vite on port $(PORT)..."
	$(PKG_MANAGER) run dev > $(LOG_FILE) 2>&1 &
	echo $$! > $(PID_FILE)
	@sleep 1
	@echo "pid=$$(cat $(PID_FILE)) log=$(LOG_FILE)"
	@echo "host: http://localhost:$(PORT)"

watch: ## Start the vite dev server in the foreground
	$(PKG_MANAGER) run dev

stop: ## Stop the dev server (PID file > lsof > pkill)
	@if [ -f $(PID_FILE) ]; then \
	  pid=$$(cat $(PID_FILE)); \
	  kill $$pid 2>/dev/null || true; \
	  rm -f $(PID_FILE); \
	fi
	@pid=$$(lsof -ti tcp:$(PORT) 2>/dev/null || true); \
	if [ -n "$$pid" ]; then kill $$pid 2>/dev/null || true; fi
	@pkill -f "vite.*$(PORT)" 2>/dev/null || true
	@true

status: ## Show whether the dev server is running
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	  echo "running pid=$$(cat $(PID_FILE)) port=$(PORT)"; \
	else \
	  echo "stopped"; \
	fi

logs: ## Tail the dev server log
	@tail -f $(LOG_FILE)

up: install dev ## Install + start (docker-compose-style)
	@echo "up: http://localhost:$(PORT)"

down: stop ## Stop (docker-compose-style)
	@echo "down."

typecheck: ## Run tsc --noEmit
	$(PKG_MANAGER) run typecheck

test: ## Run vitest once
	$(PKG_MANAGER) run test

check-report: ## Assert every emitted repo-remediation.html was rendered by this tree
	$(PKG_MANAGER) run check:report
