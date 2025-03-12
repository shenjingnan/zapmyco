# Poetry Setup Guide

This guide will help you initialize Poetry in your project and migrate from uv to Poetry for dependency management.

## Prerequisites

Make sure you have Poetry installed:

```bash
# Install Poetry
curl -sSL https://install.python-poetry.org | python3 -

# Verify installation
poetry --version
```

## Initializing Poetry in Your Project

The `pyproject.toml` file has already been updated to use Poetry's format. Now you need to generate a `poetry.lock` file:

```bash
# Navigate to the backend directory
cd /workspaces/building-os/apps/backend

# Initialize the Poetry environment
poetry install
```

This will create a `poetry.lock` file and install all dependencies.

## Using Poetry

### Installing Dependencies

```bash
# Install all dependencies
poetry install

# Install with specific groups
poetry install --with dev,test
```

### Adding New Dependencies

```bash
# Add a new dependency
poetry add package-name

# Add a development dependency
poetry add --group dev package-name

# Add a test dependency
poetry add --group test package-name
```

### Removing Dependencies

```bash
# Remove a dependency
poetry remove package-name
```

### Running Commands

```bash
# Run a Python script
poetry run python script.py

# Run the server
poetry run python main.py
# or
poetry run server
```

### Updating Dependencies

```bash
# Update all dependencies
poetry update

# Update a specific dependency
poetry update package-name
```

### Exporting Requirements

```bash
# Export requirements.txt
poetry export -f requirements.txt --output requirements.txt
```

## Docker Integration

The Dockerfile has been updated to use Poetry. When building the Docker image, Poetry will be installed and used to manage dependencies.

## CI/CD Integration

If you're using CI/CD pipelines, make sure to update them to use Poetry instead of uv. Here's an example for GitHub Actions:

```yaml
steps:
  - uses: actions/checkout@v3
  - name: Set up Python
    uses: actions/setup-python@v4
    with:
      python-version: '3.12'
  - name: Install Poetry
    run: |
      curl -sSL https://install.python-poetry.org | python3 -
      echo "$HOME/.local/bin" >> $GITHUB_PATH
  - name: Install dependencies
    run: |
      cd apps/backend
      poetry install
  - name: Run tests
    run: |
      cd apps/backend
      poetry run pytest
``` 