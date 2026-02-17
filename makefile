# Makefile for Redemption Tournament Tracker

# Variables
PROJECT_NAME = redemption-tournament-tracker
PARAGON_CSV_URL = https://docs.google.com/spreadsheets/d/e/2PACX-1vSGru8yp-5e84cRUuEghnUasXtf2Ep_MfZ4XAYHC81VTfCw9PdkRL1VblX1U_PVl8HuWG3f_4XL6PdO/pub?output=csv
PARAGON_CSV_PATH = app/decklist/card-search/data/paragons.csv
PARAGON_TS_PATH = app/decklist/card-search/data/paragons.ts

# Default target
all: setup

# Help
help:
	@echo "📖 Redemption Tournament Tracker - Make Commands"
	@echo ""
	@echo "Setup & Development:"
	@echo "  make install         - Install dependencies"
	@echo "  make dev            - Run development server"
	@echo "  make dev-windows    - Run dev server (Windows: auto-adds Node.js to PATH)"
	@echo "  make build          - Build for production"
	@echo "  make start          - Start production server"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean          - Remove node_modules and lock files"
	@echo "  make fresh          - Clean and reinstall"
	@echo ""
	@echo "Paragon Data:"
	@echo "  make update-paragons - Download latest Paragon data and regenerate TypeScript"
	@echo "  make paragons        - Alias for update-paragons"
	@echo ""

# Install dependencies
install:
	npm install

# Run the development server
run:
	npm run dev
	
dev:
	npm run dev

# Windows: Add Node.js to PATH and run dev server (with SSL bypass for corporate proxies)
# Copy-paste this into PowerShell: $env:Path += ';C:\Program Files\nodejs\'; $env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run dev
dev-windows:
	@powershell -Command "$$env:Path += ';C:\\Program Files\\nodejs\\'; $$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run dev"

# Build the project
build:
	npm run build

# Start the production server
start:
	npm run start

# Setup the project
setup: install

# Clean up node_modules and lock files
clean:
	rm -rf node_modules package-lock.json

# Initialize a fresh project (clean and setup)
fresh: clean setup

# Paragon data management
update-paragons:
	@echo "📥 Downloading latest Paragon data from Google Sheets..."
	@curl -sL "$(PARAGON_CSV_URL)" > $(PARAGON_CSV_PATH)
	@echo "✅ Downloaded to $(PARAGON_CSV_PATH)"
	@echo "🔄 Generating TypeScript data..."
	@node scripts/parse-paragons.js
	@echo "✅ Paragon data updated successfully!"
	@echo "📊 Generated $(PARAGON_TS_PATH)"

# Check Paragon data (download and generate)
paragons: update-paragons

.PHONY: all install run dev dev-windows build start setup clean fresh update-paragons paragons
