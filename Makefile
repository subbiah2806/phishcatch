# PhishCatch Makefile
# Simple setup and run commands for PhishCatch

SHELL := /bin/bash
PSK := phishcatch-secret-key-2024
EXTENSION_PATH := $(shell pwd)/extension/dist
BRAVE_PATH := /Applications/Brave Browser.app/Contents/MacOS/Brave Browser
BRAVE_DMG_URL := https://laptop-updates.brave.com/latest/osx

.PHONY: all setup check-brave install-brave check-node install-node check-yarn install-yarn check-python install-python install-deps start start-ui start-be open-brave clean clear help

# Default target
all: help

# Full setup and start
setup: check-brave check-node check-yarn check-python install-deps
	@echo "✅ Setup complete!"

# Clear ports and kill running processes
clear:
	@echo "🧹 Clearing ports and processes..."
	@lsof -ti:8000 | xargs kill -9 2>/dev/null || true
	@pkill -f "uvicorn main:app" 2>/dev/null || true
	@pkill -f "webpack.*watch" 2>/dev/null || true
	@echo "✅ Ports cleared"

# Start everything
start: clear build
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "📋 PASTE THIS CONFIG INTO EXTENSION DEBUG TAB:"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo '{'
	@echo '  "data_expiry": 30,'
	@echo '  "display_reuse_alerts": true,'
	@echo '  "enable_debug_gui": true,'
	@echo '  "enterprise_domains": ["practicetestautomation.com"],'
	@echo '  "expire_hash_on_use": false,'
	@echo '  "ignored_domains": [],'
	@echo '  "manual_password_entry": false,'
	@echo '  "pbkdf2_iterations": 100000,'
	@echo '  "phishcatch_server": "http://localhost:8000",'
	@echo '  "psk": "$(PSK)",'
	@echo '  "url_sanitization_level": "host",'
	@echo '  "username_regexes": [],'
	@echo '  "username_selectors": [],'
	@echo '  "banned_urls": []'
	@echo '}'
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "📝 TEST CREDENTIALS (for practicetestautomation.com):"
	@echo "   Username: student"
	@echo "   Password: Password123"
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@$(MAKE) start-be-bg
	@$(MAKE) start-ui-bg
	@$(MAKE) open-brave
	@echo ""
	@echo "🚀 PhishCatch is running!"
	@echo "   - Backend: http://localhost:8000"
	@echo "   - Extension: Built in watch mode"
	@echo "   - Browser: Isolated Brave instance"
	@echo ""
	@echo "⚠️  ONE-TIME SETUP: Enable Developer Mode in brave://extensions"
	@echo ""
	@echo "Press Ctrl+C to stop all services"
	@wait

# Check and install Brave
check-brave:
	@if [ -f "$(BRAVE_PATH)" ]; then \
		echo "✅ Brave Browser found"; \
	else \
		echo "❌ Brave Browser not found"; \
		$(MAKE) install-brave; \
	fi

install-brave:
	@echo "📥 Downloading Brave Browser..."
	@curl -L -o /tmp/brave.dmg "$(BRAVE_DMG_URL)"
	@echo "📦 Installing Brave Browser..."
	@hdiutil attach /tmp/brave.dmg -quiet
	@cp -R "/Volumes/Brave Browser/Brave Browser.app" /Applications/
	@hdiutil detach "/Volumes/Brave Browser" -quiet
	@rm /tmp/brave.dmg
	@echo "✅ Brave Browser installed"

# Check and install Node.js via nvm
check-node:
	@if command -v node &> /dev/null; then \
		echo "✅ Node.js found: $$(node --version)"; \
	else \
		echo "❌ Node.js not found"; \
		$(MAKE) install-node; \
	fi

install-node:
	@echo "📥 Installing nvm..."
	@if [ ! -d "$$HOME/.nvm" ]; then \
		curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; \
	fi
	@echo "📥 Installing Node.js via nvm..."
	@source $$HOME/.nvm/nvm.sh && nvm install --lts && nvm use --lts
	@echo "✅ Node.js installed"

# Check and install Yarn
check-yarn:
	@if command -v yarn &> /dev/null; then \
		echo "✅ Yarn found: $$(yarn --version)"; \
	else \
		echo "❌ Yarn not found"; \
		$(MAKE) install-yarn; \
	fi

install-yarn:
	@echo "📥 Installing Yarn..."
	@npm install -g yarn
	@echo "✅ Yarn installed"

# Check and install Python
check-python:
	@if command -v python3 &> /dev/null; then \
		echo "✅ Python found: $$(python3 --version)"; \
	else \
		echo "❌ Python not found"; \
		$(MAKE) install-python; \
	fi

install-python:
	@echo "📥 Installing Python via Homebrew..."
	@if ! command -v brew &> /dev/null; then \
		/bin/bash -c "$$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; \
	fi
	@brew install python
	@echo "✅ Python installed"

# Install all dependencies
install-deps: install-ui-deps install-be-deps
	@echo "✅ All dependencies installed"

install-ui-deps:
	@echo "📦 Installing UI dependencies..."
	@cd extension && yarn install
	@echo "✅ UI dependencies installed"

install-be-deps:
	@echo "📦 Installing Backend dependencies..."
	@cd server/app && \
		python3 -m venv venv && \
		source venv/bin/activate && \
		pip install -r requirements.txt
	@echo "✅ Backend dependencies installed"

# Build extension
build:
	@echo "🔨 Building extension..."
	@cd extension && yarn build
	@echo "✅ Extension built"

# Start UI in watch mode (foreground)
start-ui:
	@echo "🎨 Starting UI in watch mode..."
	@cd extension && yarn watch

# Start UI in background
start-ui-bg:
	@echo "🎨 Starting UI in watch mode (background)..."
	@cd extension && yarn watch &

# Start Backend (foreground)
start-be:
	@echo "🖥️  Starting Backend server..."
	@cd server/app && \
		source venv/bin/activate && \
		PRESHARED_KEY=$(PSK) uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start Backend in background
start-be-bg:
	@echo "🖥️  Starting Backend server (background)..."
	@cd server/app && \
		source venv/bin/activate && \
		PRESHARED_KEY=$(PSK) uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
	@sleep 2

# Isolated profile directories for PhishCatch testing
BRAVE_PROFILE := /tmp/phishcatch-brave-profile
CHROME_PROFILE := /tmp/phishcatch-chrome-profile

# Open Brave with extension pre-loaded (isolated instance)
open-brave:
	@echo "🦁 Opening isolated Brave Browser with PhishCatch extension..."
	@if [ -d "$(EXTENSION_PATH)" ]; then \
		rm -rf "$(BRAVE_PROFILE)"; \
		mkdir -p "$(BRAVE_PROFILE)"; \
		"$(BRAVE_PATH)" \
			--user-data-dir="$(BRAVE_PROFILE)" \
			--load-extension="$(EXTENSION_PATH)" \
			--no-first-run \
			--no-default-browser-check \
			--disable-default-apps \
			--disable-sync \
			--disable-background-networking \
			--new-window \
			"https://chatgpt.com/" \
			"https://practicetestautomation.com/practice-test-login/" & \
	else \
		echo "❌ Extension not built. Run 'make build' first"; \
		exit 1; \
	fi

# Open Chrome with extension (alternative, isolated)
open-chrome:
	@echo "🌐 Opening isolated Chrome with PhishCatch extension..."
	@if [ -d "$(EXTENSION_PATH)" ]; then \
		rm -rf "$(CHROME_PROFILE)"; \
		mkdir -p "$(CHROME_PROFILE)"; \
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
			--user-data-dir="$(CHROME_PROFILE)" \
			--load-extension="$(EXTENSION_PATH)" \
			--no-first-run \
			--no-default-browser-check \
			--disable-default-apps \
			--disable-sync \
			--disable-background-networking \
			--new-window \
			"https://practicetestautomation.com/practice-test-login/" & \
	else \
		echo "❌ Extension not built. Run 'make build' first"; \
		exit 1; \
	fi

# Quick start (assumes deps are installed)
quick: build
	@$(MAKE) start

# Dev mode - just UI and BE without browser
dev:
	@echo "🔧 Starting development mode..."
	@$(MAKE) start-be-bg
	@$(MAKE) start-ui

# Clean build artifacts
clean:
	@echo "🧹 Cleaning..."
	@rm -rf extension/dist
	@rm -rf extension/node_modules
	@rm -rf server/app/venv
	@rm -rf server/app/__pycache__
	@echo "✅ Cleaned"

# Stop all running processes
stop:
	@echo "🛑 Stopping PhishCatch services..."
	@pkill -f "uvicorn main:app" || true
	@pkill -f "webpack.*watch" || true
	@echo "✅ Services stopped"

# Help
help:
	@echo ""
	@echo "🎣 PhishCatch Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup:"
	@echo "  setup        - Check and install all dependencies (Brave, Node, Yarn, Python)"
	@echo "  install-deps - Install UI and Backend dependencies only"
	@echo "  clean        - Remove all build artifacts and dependencies"
	@echo ""
	@echo "Running:"
	@echo "  start        - Build, start BE, start UI, open Brave (full stack)"
	@echo "  quick        - Quick start (assumes deps installed)"
	@echo "  dev          - Start BE and UI only (no browser)"
	@echo "  stop         - Stop all running services"
	@echo "  clear        - Kill port 8000 and running processes"
	@echo ""
	@echo "Individual:"
	@echo "  build        - Build the extension"
	@echo "  start-ui     - Start UI in watch mode"
	@echo "  start-be     - Start Backend server"
	@echo "  open-brave   - Open Brave with extension loaded"
	@echo "  open-chrome  - Open Chrome with extension loaded"
	@echo ""
	@echo "PSK Key: $(PSK)"
	@echo ""
