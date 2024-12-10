# Makefile for Redemption Tournament Tracker

# Variables
PROJECT_NAME = redemption-tournament-tracker

# Default target
all: setup

# Install dependencies
install:
	npm install

# Run the development server
run:
	npm run dev

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
