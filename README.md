# ZapMyco

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=zapmyco&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=zapmyco)

## Introduction

Powered by AI

## Quick Start

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

BentoUI style

## Setup

```bash
npm install
```

## Development Container

This project supports development using VS Code's development container. The development container provides a pre-configured development environment with all necessary tools and dependencies.

### Development Environment Features

- Based on Python 3.12 and Node.js 20
- Uses uv for Python dependency management (faster than traditional pip)
- Pre-installed pnpm and NX CLI for frontend development
- Automatically configured virtual environment

### Using the Development Container

1. Install [VS Code](https://code.visualstudio.com/) and the [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension
2. Clone this repository and open it in VS Code
3. When prompted, click "Reopen in Container", or use the command palette (F1) to run "Remote-Containers: Reopen in Container"

### Mirror Configuration

To support global developers, the development container uses official package mirrors by default. For developers in mainland China, we provide a script that automatically detects the network environment and configures domestic mirrors:

```bash
# Run in the project root directory
chmod +x .devcontainer/setup-mirrors.sh
./.devcontainer/setup-mirrors.sh
```

After running this script, rebuild the development container to apply the changes.

## Code Contribution
